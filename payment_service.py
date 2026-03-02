"""
=============================================================
  payment_service.py
  Servicio de cobro SSP headless para ZeroMarket
  Puerto HTTP: 5001
  Eventos por stdout (JSON) leídos por cashService.ts

  Endpoints:
    POST /payment/start   { "totalCents": 150, "orderId": "ORD-123" }
    POST /payment/cancel
    GET  /payment/status
=============================================================
"""

import json
import sys
import threading
import time
import struct
import serial
import serial.tools.list_ports
from contextlib import contextmanager
from http.server import HTTPServer, BaseHTTPRequestHandler

# ── Importar lógica del tester (mismo directorio) ─────────
# Reutilizamos las clases y funciones ya probadas
sys.path.insert(0, '.')
from eSSPCrypto import eSSPCrypto

# ══════════════════════════════════════════════════════════
#  CONFIGURACIÓN
# ══════════════════════════════════════════════════════════

COM_PORT   = 'COM7'
BAUD_RATE  = 9600
HTTP_PORT  = 5001
COUNTRY    = 'USD'

# ══════════════════════════════════════════════════════════
#  CRC-16 SSP
# ══════════════════════════════════════════════════════════

def crc16_ssp(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= (byte << 8)
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x8005) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc

def build_packet(address: int, seq_bit: int, data: bytes) -> bytes:
    seqid   = ((seq_bit & 1) << 7) | (address & 0x7F)
    length  = len(data)
    payload = bytes([seqid, length]) + data
    crc     = crc16_ssp(payload)
    raw     = bytes([0x7F]) + payload + bytes([crc & 0xFF, (crc >> 8) & 0xFF])
    stuffed = bytes([0x7F])
    for b in raw[1:]:
        stuffed += bytes([b])
        if b == 0x7F:
            stuffed += bytes([0x7F])
    return stuffed

def parse_response(raw: bytes) -> tuple:
    if not raw or raw[0] != 0x7F:
        return 0, b""
    destuffed = bytearray()
    i = 1
    while i < len(raw):
        destuffed.append(raw[i])
        if raw[i] == 0x7F and i + 1 < len(raw) and raw[i + 1] == 0x7F:
            i += 2
        else:
            i += 1
    if len(destuffed) < 3:
        return 0, b""
    length = destuffed[1]
    data   = bytes(destuffed[2: 2 + length])
    if not data:
        return 0, b""
    return data[0], data[1:]

def parse_setup_request(data: bytes) -> dict:
    if len(data) < 9:
        return {}
    try:
        unit_type  = data[0]
        firmware   = data[1:5].decode('ascii', errors='ignore')
        country    = data[5:8].decode('ascii', errors='ignore')
        protocol   = data[8]
        num_denoms = data[9] if len(data) > 9 else 0
        denoms = []
        for i in range(num_denoms):
            base = 10 + i * 2
            if base + 2 <= len(data):
                val = struct.unpack_from('<H', data, base)[0]
                denoms.append(val)
        return {'unit_type': unit_type, 'firmware': firmware,
                'country': country, 'protocol': protocol, 'denoms': denoms}
    except Exception:
        return {}

MULTI_COUNTRY_EVENTS = {
    0xBF, 0xDA, 0xD2, 0xD7, 0xD8, 0xD5,
    0xB3, 0xB4, 0xDC, 0xDD, 0xE6, 0xD9, 0xD6, 0xB1,
}

def parse_poll_events(extra: bytes, proto: int = 7) -> list:
    result = []
    i = 0
    while i < len(extra):
        code = extra[i]; i += 1
        ev_data = b''
        if proto >= 6 and code in MULTI_COUNTRY_EVENTS:
            if i < len(extra):
                n  = extra[i]
                sz = 1 + n * 7
                ev_data = extra[i: i + sz]
                i += sz
        elif code in (0xEF, 0xEE, 0xDB):
            if i < len(extra):
                ev_data = extra[i:i+1]; i += 1
        result.append({'code': code, 'data': ev_data})
    return result

def extract_value_country(ev_data: bytes) -> tuple:
    if not ev_data or len(ev_data) < 8:
        return 0, ''
    n = ev_data[0]
    if n > 0 and len(ev_data) >= 8:
        val     = struct.unpack_from('<I', ev_data, 1)[0]
        country = ev_data[5:8].decode('ascii', errors='ignore')
        return val, country
    return 0, ''

NV200_CHANGE_DENOMS = [1000, 500]
SCS_CHANGE_DENOMS   = [100, 25, 10, 5, 1]
NV200_CHAN = {1: 100, 2: 200, 3: 500, 4: 1000, 5: 2000}
PAYOUT_ERRORS = {1: 'Sin suficiente valor', 2: 'No puede pagar exacto',
                 3: 'Dispositivo ocupado',   4: 'Dispositivo deshabilitado'}
ROUTE_ERRORS  = {1: 'Sin payout conectado', 2: 'Moneda inválida', 3: 'Fallo payout'}

def calculate_change_strategy(change_cents, nv200_levels, scs_levels):
    if change_cents == 0:
        return {'nv200': 0, 'scs': 0, 'feasible': True}
    nv200_pay = 0; remaining = change_cents
    for denom in NV200_CHANGE_DENOMS:
        available = nv200_levels.get(denom, 0)
        while remaining >= denom and available > 0:
            nv200_pay += denom; remaining -= denom; available -= 1
    scs_pay = 0
    for denom in SCS_CHANGE_DENOMS:
        available = scs_levels.get(denom, 0)
        while remaining >= denom and available > 0:
            scs_pay += denom; remaining -= denom; available -= 1
    feasible = remaining == 0
    return {'nv200': nv200_pay, 'scs': scs_pay, 'feasible': feasible}

# ══════════════════════════════════════════════════════════
#  SSP DRIVER
# ══════════════════════════════════════════════════════════

class SSPDriver:
    def __init__(self, ser, address, bus_lock):
        self.ser     = ser
        self.address = address
        self.seq     = 1
        self.crypto  = eSSPCrypto()
        self._lock   = bus_lock
        self.info    = {}

    @contextmanager
    def fast_timeout(self, t=0.2):
        old = self.ser.timeout; self.ser.timeout = t
        try: yield
        finally: self.ser.timeout = old

    def send(self, cmd, params=b''):
        with self._lock:
            pkt = build_packet(self.address, self.seq, bytes([cmd]) + params)
            self.ser.reset_input_buffer()
            self.ser.write(pkt)
            time.sleep(0.06)
            raw = self.ser.read(256)
            self.seq ^= 1
            code, extra = parse_response(raw)
            return code, extra, raw

    def send_encrypted(self, cmd, params=b''):
        if not self.crypto.is_negotiated:
            raise RuntimeError('eSSP: clave no negociada')
        with self._lock:
            enc_payload = self.crypto.encrypt_packet(cmd, params)
            pkt = build_packet(self.address, self.seq, enc_payload)
            self.ser.reset_input_buffer()
            self.ser.write(pkt)
            time.sleep(0.08)
            raw = self.ser.read(256)
            self.seq ^= 1
            if not raw or raw[0] != 0x7F:
                return (0, b''), raw
            destuffed = bytearray(); i = 1
            while i < len(raw):
                destuffed.append(raw[i])
                if raw[i] == 0x7F and i + 1 < len(raw) and raw[i+1] == 0x7F: i += 2
                else: i += 1
            if len(destuffed) < 3: return (0, b''), raw
            resp_len  = destuffed[1]
            resp_data = bytes(destuffed[2: 2 + resp_len])
            if not resp_data: return (0, b''), raw
            if resp_data[0] == 0x7E:
                decrypted = self.crypto.decrypt_response(resp_data)
                if not decrypted: return (0xFE, b''), raw
                return decrypted, raw
            return (resp_data[0], resp_data[1:]), raw

    def force_sync(self):
        for _ in range(3):
            self.seq = 1; code, _, _ = self.send(0x11)
            self.seq = 0
            if code == 0xF0: return True
            time.sleep(0.2)
        return False

    def negotiatekeys(self):
        self.seq = 0
        code, _, _ = self.send(0x11)
        if code != 0xF0: return False
        time.sleep(0.1)
        self.send(0x06, bytes([6]))
        time.sleep(0.05)
        return self.crypto.negotiate(self)

    def set_protocol(self, v=7):
        code, _, _ = self.send(0x06, bytes([v]))
        return code == 0xF0

    def setup_request(self):
        code, data, _ = self.send(0x05)
        return data if code == 0xF0 else b''

    def enable(self):
        code, _, _ = self.send(0x0A); return code == 0xF0

    def disable(self):
        code, _, _ = self.send(0x09); return code == 0xF0

    def poll(self):
        return self.send(0x07)

    def reject_note(self):
        code, _, _ = self.send(0x08); return code == 0xF0

    def hold_note(self):
        code, _, _ = self.send(0x18); return code == 0xF0

    def get_all_levels(self):
        code, data, _ = self.send(0x22)
        if code != 0xF0 or not data: return []
        num = data[0]; result = []
        for i in range(num):
            base = 1 + i * 9
            if base + 9 > len(data): break
            level   = struct.unpack_from('<H', data, base)[0]
            value   = struct.unpack_from('<I', data, base + 2)[0]
            country = data[base+6: base+9].decode('ascii', errors='ignore')
            result.append({'level': level, 'value': value, 'country': country})
        return result

    def payout_amount(self, cents, country, test=False):
        option = 0x19 if test else 0x58
        params = struct.pack('<I', cents) + country.encode('ascii') + bytes([option])
        if self.crypto.is_negotiated:
            (code, extra), _ = self.send_encrypted(0x33, params)
        else:
            code, extra, _ = self.send(0x33, params)
        return code, extra

    def set_denomination_route(self, cents, country, route=0x00):
        params = (bytes([route]) + struct.pack('<I', cents) + country.encode('ascii'))
        if self.crypto.is_negotiated:
            (code, extra), _ = self.send_encrypted(0x3B, params)
        else:
            code, extra, _ = self.send(0x3B, params)
        return code, extra

    def enable_payout_device(self):
        if self.crypto.is_negotiated:
            (code, _), _ = self.send_encrypted(0x5C, bytes([0x00]))
        else:
            code, _, _ = self.send(0x5C, bytes([0x00]))
        return code == 0xF0

    def set_inhibits(self, b1=0xFF, b2=0xFF):
        code, _, _ = self.send(0x02, bytes([b1, b2])); return code == 0xF0

    def enable_coin_mech(self, denoms, country):
        with self.fast_timeout(0.2):
            for cents in denoms:
                params = bytes([0x01]) + struct.pack('<H', cents) + country.encode()
                self.send(0x40, params); time.sleep(0.02)
            self.send(0x49, bytes([0x01])); time.sleep(0.02)
        return self.enable()

    def reactivate_coin_mech(self):
        self.send(0x49, bytes([0x01])); time.sleep(0.05)
        return self.enable()

# ══════════════════════════════════════════════════════════
#  ESTADO GLOBAL DEL SERVICIO
# ══════════════════════════════════════════════════════════

class PaymentService:
    IDLE       = 'idle'
    COLLECTING = 'collecting'
    DISPENSING = 'dispensing'
    COMPLETE   = 'complete'
    CANCELLED  = 'cancelled'
    ERROR      = 'error'

    def __init__(self):
        self._lock        = threading.Lock()
        self.status       = self.IDLE
        self.price_cents  = 0
        self.total_cents  = 0
        self.order_id     = ''
        self.escrow_value = 0
        self.escrow_ctry  = ''
        self.coin_bdwn    = {}
        self.note_bdwn    = {}
        self.start_time   = None
        self.timeout_secs = 180

        # Callbacks registrados por el HTTP handler
        self._event_callbacks = []

        # Hardware
        self._ser      = None
        self._bus_lock = threading.Lock()
        self.scs       = None
        self.nv200     = None
        self._ready    = False
        self._init_thread = None

    # ── Eventos ────────────────────────────────────────────
    def register_callback(self, cb):
        with self._lock:
            self._event_callbacks.append(cb)

    def unregister_callback(self, cb):
        with self._lock:
            if cb in self._event_callbacks:
                self._event_callbacks.remove(cb)

    def emit(self, event: dict):
        """Emite evento a todos los callbacks registrados (cashService.ts los lee)"""
        line = json.dumps(event)
        print(line, flush=True)  # stdout → Node.js child_process
        with self._lock:
            for cb in list(self._event_callbacks):
                try:
                    cb(event)
                except Exception:
                    pass

    # ── Init hardware ──────────────────────────────────────
    def connect(self, port=COM_PORT):
        try:
            self._bus_lock = threading.Lock()
            self._ser = serial.Serial(
                port=port, baudrate=BAUD_RATE,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_TWO,
                timeout=1)
            self.scs   = SSPDriver(self._ser, 0x10, self._bus_lock)
            self.nv200 = SSPDriver(self._ser, 0x00, self._bus_lock)
            self._init_thread = threading.Thread(target=self._startup_init, daemon=True)
            self._init_thread.start()
            return True
        except Exception as e:
            self.emit({'event': 'ERROR', 'message': f'No se pudo abrir {port}: {e}'})
            return False

    def _startup_init(self):
        ok_scs   = self._init_scs(enable_after=False)
        ok_nv200 = self._init_nv200(enable_after=False)
        if ok_scs and ok_nv200:
            self._ready = True
            self.emit({'event': 'HARDWARE_READY', 'message': 'SCS + NV200 listos'})
        else:
            self.emit({'event': 'ERROR', 'message': 'Fallo en init de hardware'})

    def _init_scs(self, enable_after=True):
        drv     = self.scs
        country = COUNTRY
        if not drv.force_sync(): return False
        raw  = drv.setup_request()
        info = parse_setup_request(raw) if raw else {}
        drv.info = info
        country  = info.get('country', country)
        denoms   = info.get('denoms', [1, 5, 10, 25, 100])
        proto    = info.get('protocol', 7)
        drv.set_protocol(proto)
        drv.negotiatekeys()
        for cents in denoms:
            drv.set_denomination_route(cents, country, route=0x00)
            time.sleep(0.06)
        for cents in denoms:
            params = bytes([0x01]) + struct.pack('<H', cents) + country.encode()
            drv.send(0x40, params); time.sleep(0.05)
        drv.send(0x49, bytes([0x01])); time.sleep(0.05)
        if enable_after: return drv.enable()
        return True

    def _init_nv200(self, enable_after=True):
        drv     = self.nv200
        country = COUNTRY
        NV200_DENOMS = [100, 200, 500, 1000, 2000]
        if not drv.force_sync(): return False
        raw  = drv.setup_request()
        info = parse_setup_request(raw) if raw else {}
        drv.info = info
        country  = info.get('country', country)
        proto    = info.get('protocol', 7)
        proto_set = max(proto, 6)
        drv.set_protocol(proto_set)
        drv.info['protocol'] = proto_set
        drv.set_inhibits(0xFF, 0xFF)
        if not drv.negotiatekeys(): return False
        for cents in NV200_DENOMS:
            drv.set_denomination_route(cents, country, route=0x00)
            time.sleep(0.06)
        if enable_after:
            ok  = drv.enable()
            ok2 = drv.enable_payout_device()
            return ok and ok2
        return True

    # ── Transacción ────────────────────────────────────────
    def start_transaction(self, price_cents: int, order_id: str) -> dict:
        if not self._ready:
            return {'ok': False, 'error': 'Hardware no listo'}
        if self.status not in (self.IDLE, self.COMPLETE, self.CANCELLED, self.ERROR):
            return {'ok': False, 'error': f'Transacción en curso: {self.status}'}

        self.status       = self.COLLECTING
        self.price_cents  = price_cents
        self.total_cents  = 0
        self.order_id     = order_id
        self.escrow_value = 0
        self.escrow_ctry  = ''
        self.coin_bdwn    = {}
        self.note_bdwn    = {}
        self.start_time   = time.time()

        threading.Thread(target=self._quick_enable_and_poll, daemon=True).start()
        return {'ok': True}

    def _quick_enable_and_poll(self):
        country = self.nv200.info.get('country', COUNTRY)
        self.nv200.enable()
        self.nv200.enable_payout_device()
        self.scs.reactivate_coin_mech()
        self.emit({'event': 'PAYMENT_STARTED',
                   'totalCents': self.price_cents,
                   'orderId': self.order_id})
        self._collect_loop(country)

    def _collect_loop(self, country: str):
        while self.status == self.COLLECTING:
            elapsed = time.time() - (self.start_time or time.time())
            if elapsed > self.timeout_secs:
                self.cancel_transaction()
                return

            # Poll SCS
            c, ex, _ = self.scs.poll()
            if c == 0xF0 and ex:
                for ev in parse_poll_events(ex, self.scs.info.get('protocol', 7)):
                    self._handle_scs_event(ev, country)

            # Poll NV200
            c, ex, _ = self.nv200.poll()
            if c == 0xF0 and ex:
                for ev in parse_poll_events(ex, self.nv200.info.get('protocol', 7)):
                    self._handle_nv200_event(ev, country)
            elif c == 0xF1:
                time.sleep(0.3)
                self.nv200.enable()
                self.nv200.enable_payout_device()

            # Hold billete en escrow mientras no alcance el precio
            if self.escrow_value > 0:
                self.nv200.hold_note()

            if self.total_cents >= self.price_cents:
                time.sleep(0.3)
                self._process_payment(country)
                return

            time.sleep(0.15)

    def _handle_scs_event(self, ev: dict, country: str):
        code = ev['code']
        if code == 0xBF:
            val, ctry = extract_value_country(ev['data'])
            if val:
                self.total_cents += val
                self.coin_bdwn[val] = self.coin_bdwn.get(val, 0) + 1
                self.emit({
                    'event': 'COIN_CREDIT',
                    'valueInserted': self.total_cents,
                    'remaining': max(0, self.price_cents - self.total_cents),
                    'coinValue': val
                })
        elif code == 0xF1:
            self.scs.reactivate_coin_mech()

    def _handle_nv200_event(self, ev: dict, country: str):
        code = ev['code']
        if code == 0xEF:
            channel = ev['data'][0] if ev['data'] else 0
            val = NV200_CHAN.get(channel, 0)
            if val:
                self.escrow_value = val
                self.escrow_ctry  = country
        elif code == 0xEE:
            val = self.escrow_value or NV200_CHAN.get(
                ev['data'][0] if ev['data'] else 0, 0)
            if val:
                self.total_cents += val
                self.note_bdwn[val] = self.note_bdwn.get(val, 0) + 1
                self.escrow_value   = 0
                self.emit({
                    'event': 'NOTE_CREDIT',
                    'valueInserted': self.total_cents,
                    'remaining': max(0, self.price_cents - self.total_cents),
                    'noteValue': val
                })
        elif code == 0xEC:
            self.escrow_value = 0
        elif code == 0xF1:
            self.nv200.enable()
            self.nv200.enable_payout_device()

    def _process_payment(self, country: str):
        self.status = 'processing'
        change = self.total_cents - self.price_cents

        self.scs.disable()
        self.nv200.disable()

        nv200_levels = {d['value']: d['level'] for d in self.nv200.get_all_levels()}
        scs_levels   = {d['value']: d['level'] for d in self.scs.get_all_levels()}
        strategy     = calculate_change_strategy(change, nv200_levels, scs_levels)

        if not strategy['feasible'] and strategy['nv200'] == 0 and strategy['scs'] == 0:
            self.emit({
                'event': 'PAYMENT_COMPLETE',
                'change': 0,
                'warning': 'Sin cambio suficiente — cobro exacto requerido'
            })
            self.status = self.COMPLETE
            return

        if change == 0:
            self.emit({'event': 'PAYMENT_COMPLETE', 'change': 0})
            self.status = self.COMPLETE
            return

        self.status = self.DISPENSING
        self._dispense_change(strategy, country, change)

    def _dispense_change(self, strategy: dict, country: str, change: int):
        dispensed_ok = True

        if strategy['nv200'] > 0:
            self.nv200.enable()
            self.nv200.enable_payout_device()
            time.sleep(0.2)
            code, extra = self.nv200.payout_amount(strategy['nv200'], country, test=False)
            if code == 0xF0:
                nv200_done = False
                proto = self.nv200.info.get('protocol', 7)
                for _ in range(60):
                    c, ex, _ = self.nv200.poll()
                    if c == 0xF0 and ex:
                        for ev in parse_poll_events(ex, proto):
                            if ev['code'] == 0xD2:
                                nv200_done = True
                            elif ev['code'] in (0xD5, 0xB1):
                                dispensed_ok = False; nv200_done = True
                    if nv200_done: break
                    time.sleep(0.2)
            else:
                dispensed_ok = False
            self.nv200.disable()

        if strategy['scs'] > 0:
            self.scs.enable()
            time.sleep(0.4)
            test_code, _ = self.scs.payout_amount(strategy['scs'], country, test=True)
            if test_code == 0xF0:
                code, extra = self.scs.payout_amount(strategy['scs'], country, test=False)
                if code == 0xF0:
                    scs_done = False
                    proto = self.scs.info.get('protocol', 7)
                    for _ in range(60):
                        c, ex, _ = self.scs.poll()
                        if c == 0xF0 and ex:
                            for ev in parse_poll_events(ex, proto):
                                if ev['code'] == 0xD2:
                                    scs_done = True
                                elif ev['code'] in (0xDC, 0xB1):
                                    dispensed_ok = False; scs_done = True
                        if scs_done: break
                        time.sleep(0.2)
                else:
                    dispensed_ok = False
            else:
                dispensed_ok = False
            self.scs.disable()

        self.status = self.COMPLETE
        self.emit({
            'event': 'PAYMENT_COMPLETE',
            'change': change,
            'dispensed_ok': dispensed_ok
        })

    def cancel_transaction(self):
        if self.status not in (self.COLLECTING, 'processing'):
            return {'ok': False, 'error': 'No hay transacción activa'}

        self.status = self.CANCELLED
        country = self.escrow_ctry or COUNTRY

        def do_cancel():
            if self.escrow_value > 0:
                self.nv200.reject_note()
                time.sleep(1.5)

            total_coins = sum(v * c for v, c in self.coin_bdwn.items())
            if total_coins > 0:
                self.scs.disable(); time.sleep(0.3)
                self.scs.enable(); time.sleep(0.4)
                self.scs.payout_amount(total_coins, country, test=False)
                time.sleep(3)
                self.scs.disable()

            total_notes = sum(v * c for v, c in self.note_bdwn.items())
            if total_notes > 0:
                self.nv200.enable()
                self.nv200.enable_payout_device()
                time.sleep(0.2)
                self.nv200.payout_amount(total_notes, country, test=False)
                time.sleep(5)
                self.nv200.disable()

            self.scs.disable()
            self.nv200.disable()
            self.emit({'event': 'PAYMENT_CANCELLED'})

        threading.Thread(target=do_cancel, daemon=True).start()
        return {'ok': True}

    def get_status(self):
        return {
            'status': self.status,
            'ready': self._ready,
            'totalCents': self.total_cents,
            'priceCents': self.price_cents,
            'remaining': max(0, self.price_cents - self.total_cents)
        }


# ══════════════════════════════════════════════════════════
#  HTTP SERVER
# ══════════════════════════════════════════════════════════

SERVICE = PaymentService()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # silenciar logs HTTP en stdout

    def _json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(data))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body   = json.loads(self.rfile.read(length)) if length else {}

        if self.path == '/payment/start':
            price = body.get('totalCents', 0)
            oid   = body.get('orderId', f'ORD-{int(time.time())}')
            result = SERVICE.start_transaction(int(price), str(oid))
            self._json(200 if result['ok'] else 409, result)

        elif self.path == '/payment/cancel':
            result = SERVICE.cancel_transaction()
            self._json(200 if result['ok'] else 409, result)

        else:
            self._json(404, {'error': 'Not found'})

    def do_GET(self):
        if self.path == '/payment/status':
            self._json(200, SERVICE.get_status())
        else:
            self._json(404, {'error': 'Not found'})


# ══════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════

if __name__ == '__main__':
    port_arg = COM_PORT
    if len(sys.argv) > 1:
        port_arg = sys.argv[1]

    # Conectar hardware
    ok = SERVICE.connect(port_arg)
    if not ok:
        sys.exit(1)

    # Iniciar HTTP server
    server = HTTPServer(('127.0.0.1', HTTP_PORT), Handler)
    print(json.dumps({'event': 'SERVICE_STARTED', 'port': HTTP_PORT,
                      'com': port_arg}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
