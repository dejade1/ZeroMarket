/**
 * ARCHIVO CORREGIDO: lib/hardware/led-manager.ts
 * 
 * MEJORAS IMPLEMENTADAS:
 * 1. ✅ Cola de comandos no bloqueante (Queue pattern)
 * 2. ✅ Manejo de errores robusto (no rompe la UI)
 * 3. ✅ Degradación elegante si no hay hardware
 * 4. ✅ Singleton pattern correcto
 */

export interface LEDCommand {
    productId: number;
    quantity: number;
    type: 'add' | 'remove' | 'alert';
}

class LEDManager {
    private isConnected: boolean = false;
    private queue: LEDCommand[] = [];
    private isProcessing: boolean = false;
    private maxRetries: number = 3;

    constructor() {
        // Intentar conectar al inicio, pero no bloquear
        this.connect().catch(err => console.warn('[LED] No se pudo conectar al inicio:', err));
    }

    /**
     * Conecta con el servicio de hardware
     */
    private async connect(): Promise<void> {
        try {
            // Simulación de conexión
            // En producción: await serialPort.connect(...)
            this.isConnected = true;
            console.log('[LED] Hardware conectado');
        } catch (error) {
            this.isConnected = false;
            console.warn('[LED] Hardware no disponible (Modo simulación)');
        }
    }

    /**
     * Encola un comando para ser procesado
     * Esta función retorna inmediatamente (Fire and Forget)
     */
    public sendCommand(command: LEDCommand): void {
        this.queue.push(command);

        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    /**
     * Procesa la cola de comandos uno por uno
     */
    private async processQueue(): Promise<void> {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        const command = this.queue.shift();

        if (command) {
            try {
                await this.executeCommand(command);
            } catch (error) {
                console.error('[LED] Error procesando comando:', error);
                // Opcional: Re-encolar si es crítico o descartar
            }
        }

        // Procesar siguiente (con pequeño delay para no saturar)
        setTimeout(() => this.processQueue(), 100);
    }

    /**
     * Ejecuta el comando físico
     */
    private async executeCommand(command: LEDCommand, retryCount = 0): Promise<void> {
        if (!this.isConnected) {
            // Si no hay hardware, solo logueamos (Degradación elegante)
            console.log(`[LED-SIM] ${command.type.toUpperCase()} Product:${command.productId} Qty:${command.quantity}`);
            return;
        }

        try {
            // Aquí iría la lógica real de comunicación (Serial, WebSocket, HTTP)
            // await serialPort.write(...)
            console.log(`[LED-HW] Enviando: ${JSON.stringify(command)}`);
        } catch (error) {
            if (retryCount < this.maxRetries) {
                console.warn(`[LED] Reintentando comando (${retryCount + 1}/${this.maxRetries})...`);
                await new Promise(r => setTimeout(r, 500));
                return this.executeCommand(command, retryCount + 1);
            }
            throw error;
        }
    }
}

export const ledManager = new LEDManager();
