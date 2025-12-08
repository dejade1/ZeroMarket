/**
 * ARCHIVO OPTIMIZADO: utils/errorHandler.ts
 *
 * Sistema centralizado de manejo de errores con mejoras de seguridad y rendimiento
 *
 * CARACTERÍSTICAS:
 * ✅ Clases de error personalizadas e inmutables
 * ✅ Logging centralizado con rate limiting
 * ✅ Manejo consistente de errores
 * ✅ Tipos TypeScript estrictos
 * ✅ Stack traces sanitizados
 * ✅ Protección contra memory leaks
 * ✅ Validación de contexto
 * ✅ Auto-cleanup de errores en hooks
 *
 * @version 2.0.0
 */

import { useState, useCallback, useEffect, useRef } from 'react';

// ==================== TIPOS DE ERROR ====================

export enum ErrorCode {
    // Errores de autenticación
    INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    SESSION_EXPIRED = 'SESSION_EXPIRED',
    ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',

    // Errores de validación
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    INVALID_INPUT = 'INVALID_INPUT',
    MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

    // Errores de base de datos
    DATABASE_ERROR = 'DATABASE_ERROR',
    NOT_FOUND = 'NOT_FOUND',
    DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',

    // Errores de red
    NETWORK_ERROR = 'NETWORK_ERROR',
    TIMEOUT = 'TIMEOUT',

    // Errores generales
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
    INTERNAL_ERROR = 'INTERNAL_ERROR',
}

// ==================== UTILIDADES DE SEGURIDAD ====================

/**
 * Sanitiza el contexto para evitar objetos no serializables
 * Previene fugas de información sensible
 */
function sanitizeContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!context) return undefined;

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(context)) {
        // Filtrar funciones, símbolos y valores peligrosos
        if (
            typeof value === 'function' ||
            typeof value === 'symbol' ||
            value === undefined
        ) {
            continue;
        }

        // Detectar y ofuscar posibles datos sensibles
        if (typeof key === 'string' &&
            (key.toLowerCase().includes('password') ||
             key.toLowerCase().includes('token') ||
             key.toLowerCase().includes('secret') ||
             key.toLowerCase().includes('key'))) {
            sanitized[key] = '[REDACTED]';
            continue;
        }

        // Limitar profundidad de objetos anidados para evitar ciclos
        if (typeof value === 'object' && value !== null) {
            try {
                // Intento de serialización simple para detectar ciclos
                JSON.stringify(value);
                sanitized[key] = value;
            } catch {
                sanitized[key] = '[Circular Reference]';
            }
        } else {
            sanitized[key] = value;
        }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Sanitiza stack traces para evitar exposición de rutas del sistema
 */
function sanitizeStackTrace(stack?: string): string | undefined {
    if (!stack) return undefined;

    // En producción, remover rutas absolutas del sistema
    if (import.meta.env.PROD) {
        return stack
            .split('\n')
            .map(line => line.replace(/\(.*[\/\\]/g, '('))
            .join('\n');
    }

    return stack;
}

// ==================== CLASES DE ERROR ====================

/**
 * Clase base para errores de aplicación
 * Inmutable y con propiedades de seguridad mejoradas
 */
export class AppError extends Error {
    public readonly code: ErrorCode;
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly timestamp: Date;
    public readonly context?: Readonly<Record<string, unknown>>;
    private _jsonCache?: string;

    constructor(
        message: string,
        code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
        statusCode: number = 500,
        isOperational: boolean = true,
        context?: Record<string, unknown>
    ) {
        super(message);

        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.timestamp = new Date();
        this.context = sanitizeContext(context);

        // Mantiene el stack trace correcto
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }

        // Congelar el objeto para inmutabilidad
        Object.freeze(this);
    }

    /**
     * Convierte el error a un objeto JSON
     * Usa caché para mejorar rendimiento
     */
    toJSON(): {
        name: string;
        message: string;
        code: ErrorCode;
        statusCode: number;
        timestamp: string;
        context?: Record<string, unknown>;
        stack?: string;
    } {
        if (this._jsonCache) {
            return JSON.parse(this._jsonCache);
        }

        const json = {
            name: this.name,
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            timestamp: this.timestamp.toISOString(),
            context: this.context,
            stack: import.meta.env.DEV ? sanitizeStackTrace(this.stack) : undefined,
        };

        // Cachear solo en producción para evitar consumo de memoria en dev
        if (import.meta.env.PROD) {
            this._jsonCache = JSON.stringify(json);
        }

        return json;
    }

    /**
     * Crea una copia del error con un nuevo mensaje
     * Preserva inmutabilidad
     */
    withMessage(newMessage: string): AppError {
        return new AppError(
            newMessage,
            this.code,
            this.statusCode,
            this.isOperational,
            this.context as Record<string, unknown>
        );
    }

    /**
     * Crea una copia del error con contexto adicional
     */
    withContext(additionalContext: Record<string, unknown>): AppError {
        return new AppError(
            this.message,
            this.code,
            this.statusCode,
            this.isOperational,
            { ...this.context, ...additionalContext }
        );
    }
}

/**
 * Error de validación
 */
export class ValidationError extends AppError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, ErrorCode.VALIDATION_ERROR, 400, true, context);
    }
}

/**
 * Error de autenticación
 */
export class AuthenticationError extends AppError {
    constructor(message: string = 'Credenciales inválidas', context?: Record<string, unknown>) {
        super(message, ErrorCode.INVALID_CREDENTIALS, 401, true, context);
    }
}

/**
 * Error de autorización
 */
export class AuthorizationError extends AppError {
    constructor(message: string = 'No tienes permisos para realizar esta acción', context?: Record<string, unknown>) {
        super(message, ErrorCode.FORBIDDEN, 403, true, context);
    }
}

/**
 * Error de recurso no encontrado
 */
export class NotFoundError extends AppError {
    constructor(resource: string, context?: Record<string, unknown>) {
        super(`${resource} no encontrado`, ErrorCode.NOT_FOUND, 404, true, context);
    }
}

/**
 * Error de base de datos
 */
export class DatabaseError extends AppError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, ErrorCode.DATABASE_ERROR, 500, true, context);
    }
}

/**
 * Error de red
 */
export class NetworkError extends AppError {
    constructor(message: string = 'Error de conexión', context?: Record<string, unknown>) {
        super(message, ErrorCode.NETWORK_ERROR, 503, true, context);
    }
}

// ==================== LOGGER ====================

export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: Date;
    context?: Record<string, unknown>;
    error?: Error;
}

interface LoggerConfig {
    maxLogs?: number;
    enableConsole?: boolean;
    enableExternalService?: boolean;
    rateLimitMs?: number;
}

/**
 * Type guard para verificar si un valor es un Error
 */
function isError(value: unknown): value is Error {
    return value instanceof Error;
}

/**
 * Logger centralizado con protección contra memory leaks y rate limiting
 */
class Logger {
    private logs: LogEntry[] = [];
    private maxLogs: number;
    private enableConsole: boolean;
    private enableExternalService: boolean;
    private rateLimitMs: number;
    private lastLogTimes: Map<string, number> = new Map();
    private logBuffer: LogEntry[] = [];
    private flushTimer?: NodeJS.Timeout;

    private static instance: Logger | null = null;

    constructor(config: LoggerConfig = {}) {
        this.maxLogs = config.maxLogs ?? 1000;
        this.enableConsole = config.enableConsole ?? true;
        this.enableExternalService = config.enableExternalService ?? import.meta.env.PROD;
        this.rateLimitMs = config.rateLimitMs ?? 1000;
    }

    /**
     * Singleton pattern con lazy initialization
     */
    static getInstance(config?: LoggerConfig): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger(config);
        }
        return Logger.instance;
    }

    /**
     * Verifica rate limiting
     */
    private checkRateLimit(key: string): boolean {
        const now = Date.now();
        const lastTime = this.lastLogTimes.get(key);

        if (lastTime && now - lastTime < this.rateLimitMs) {
            return false; // Rate limited
        }

        this.lastLogTimes.set(key, now);

        // Limpiar entradas antiguas para evitar memory leak
        if (this.lastLogTimes.size > 100) {
            const oldestKey = this.lastLogTimes.keys().next().value;
            this.lastLogTimes.delete(oldestKey);
        }

        return true;
    }

    /**
     * Log genérico con mejoras de rendimiento
     */
    private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
        // Rate limiting basado en mensaje + nivel
        const rateKey = `${level}-${message}`;
        if (!this.checkRateLimit(rateKey)) {
            return;
        }

        const entry: LogEntry = {
            level,
            message,
            timestamp: new Date(),
            context: sanitizeContext(context),
            error,
        };

        // Buffer circular para logs
        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            // Remover el 10% más antiguo para mejorar rendimiento
            const removeCount = Math.floor(this.maxLogs * 0.1);
            this.logs.splice(0, removeCount);
        }

        // Console output
        if (this.enableConsole) {
            this.logToConsole(entry);
        }

        // Buffer para envío a servicio externo
        if (this.enableExternalService && level === LogLevel.ERROR) {
            this.logBuffer.push(entry);
            this.scheduleFlush();
        }
    }

    /**
     * Log a consola usando map en lugar de switch
     */
    private logToConsole(entry: LogEntry): void {
        const consoleMessage = `[${entry.timestamp.toISOString()}] [${entry.level}] ${entry.message}`;

        const consoleMethods: Record<LogLevel, typeof console.log> = {
            [LogLevel.DEBUG]: console.debug,
            [LogLevel.INFO]: console.info,
            [LogLevel.WARN]: console.warn,
            [LogLevel.ERROR]: console.error,
        };

        const consoleMethod = consoleMethods[entry.level];

        if (entry.error) {
            consoleMethod(consoleMessage, entry.context, entry.error);
        } else {
            consoleMethod(consoleMessage, entry.context);
        }
    }

    /**
     * Programa flush del buffer con debouncing
     */
    private scheduleFlush(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }

        this.flushTimer = setTimeout(() => {
            this.flushLogs();
        }, 5000); // Flush cada 5 segundos
    }

    /**
     * Envía logs buffereados a servicio externo
     */
    private flushLogs(): void {
        if (this.logBuffer.length === 0) return;

        const logsToSend = [...this.logBuffer];
        this.logBuffer = [];

        logsToSend.forEach(entry => {
            this.sendToExternalService(entry);
        });
    }

    debug(message: string, context?: Record<string, unknown>): void {
        this.log(LogLevel.DEBUG, message, context);
    }

    info(message: string, context?: Record<string, unknown>): void {
        this.log(LogLevel.INFO, message, context);
    }

    warn(message: string, context?: Record<string, unknown>): void {
        this.log(LogLevel.WARN, message, context);
    }

    error(message: string, error?: unknown, context?: Record<string, unknown>): void {
        const errorObj = isError(error) ? error : undefined;
        this.log(LogLevel.ERROR, message, context, errorObj);
    }

    /**
     * Obtiene todos los logs (readonly para evitar mutaciones)
     */
    getLogs(): ReadonlyArray<Readonly<LogEntry>> {
        return Object.freeze([...this.logs]);
    }

    /**
     * Limpia los logs de forma segura
     */
    clearLogs(): void {
        this.logs = [];
        this.logBuffer = [];
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
    }

    /**
     * Envía logs a servicio externo con manejo de errores
     */
    private sendToExternalService(entry: LogEntry): void {
        try {
            // TODO: Implementar integración con servicio de logging
            // Ejemplos: Sentry, LogRocket, DataDog, CloudWatch

            // Ejemplo con Sentry:
            // if (typeof window !== 'undefined' && window.Sentry) {
            //   window.Sentry.captureException(entry.error, {
            //     level: 'error',
            //     extra: entry.context,
            //   });
            // }

            // Fallback: localStorage como backup temporal
            if (typeof window !== 'undefined' && window.localStorage) {
                const storageKey = 'app_error_logs';
                const existingLogs = localStorage.getItem(storageKey);
                const logs = existingLogs ? JSON.parse(existingLogs) : [];

                logs.push({
                    ...entry,
                    timestamp: entry.timestamp.toISOString(),
                });

                // Mantener solo los últimos 50 logs en localStorage
                if (logs.length > 50) {
                    logs.splice(0, logs.length - 50);
                }

                localStorage.setItem(storageKey, JSON.stringify(logs));
            }
        } catch (error) {
            // Silenciar errores del logger para no crear loops infinitos
            console.error('Failed to send logs to external service:', error);
        }
    }

    /**
     * Limpieza de recursos
     */
    destroy(): void {
        this.flushLogs();
        this.clearLogs();
        this.lastLogTimes.clear();
        Logger.instance = null;
    }
}

// Exportar instancia singleton con lazy initialization
export const logger = Logger.getInstance();

// ==================== MANEJADOR DE ERRORES ====================

/**
 * Convierte cualquier error en AppError de forma segura
 */
export function normalizeError(error: unknown): AppError {
    // Si ya es un AppError, retornarlo
    if (error instanceof AppError) {
        return error;
    }

    // Si es un Error estándar
    if (error instanceof Error) {
        logger.error('Unexpected error', error);
        return new AppError(
            error.message,
            ErrorCode.UNKNOWN_ERROR,
            500,
            false,
            { originalError: error.name }
        );
    }

    // Si es un string
    if (typeof error === 'string') {
        logger.error('String error', new Error(error));
        return new AppError(error, ErrorCode.UNKNOWN_ERROR);
    }

    // Si es un objeto con mensaje
    if (error && typeof error === 'object' && 'message' in error) {
        const message = String(error.message);
        logger.error('Object error', new Error(message));
        return new AppError(message, ErrorCode.UNKNOWN_ERROR);
    }

    // Error completamente desconocido
    logger.error('Unknown error type', new Error(String(error)));
    return new AppError(
        'Ocurrió un error inesperado',
        ErrorCode.UNKNOWN_ERROR,
        500,
        false
    );
}

/**
 * Maneja errores de forma asíncrona con tuple pattern
 * Preserva inmutabilidad del error
 */
export async function handleAsyncError<T>(
    promise: Promise<T>,
    errorMessage?: string
): Promise<[AppError | null, T | null]> {
    try {
        const data = await promise;
        return [null, data];
    } catch (error) {
        const appError = normalizeError(error);

        // Crear nuevo error con mensaje personalizado si se proporciona
        const finalError = errorMessage
            ? appError.withMessage(errorMessage)
            : appError;

        logger.error(finalError.message, error);
        return [finalError, null];
    }
}

/**
 * Wrapper para funciones que pueden lanzar errores
 * Mejora type safety
 */
export function tryCatch<T extends (...args: never[]) => unknown>(
    fn: T,
    errorMessage?: string
): (...args: Parameters<T>) => ReturnType<T> | AppError {
    return (...args: Parameters<T>) => {
        try {
            return fn(...args) as ReturnType<T>;
        } catch (error) {
            const appError = normalizeError(error);

            const finalError = errorMessage
                ? appError.withMessage(errorMessage)
                : appError;

            logger.error(finalError.message, error);
            return finalError as ReturnType<T>;
        }
    };
}

// ==================== UTILIDADES ====================

/**
 * Verifica si un error es operacional (esperado)
 */
export function isOperationalError(error: Error): boolean {
    if (error instanceof AppError) {
        return error.isOperational;
    }
    return false;
}

/**
 * Obtiene mensaje de error user-friendly
 */
export function getUserFriendlyMessage(error: unknown): string {
    if (error instanceof AppError) {
        return error.message;
    }

    if (error instanceof Error) {
        // En producción, no mostrar detalles técnicos
        if (import.meta.env.PROD) {
            return 'Ocurrió un error. Por favor, intenta nuevamente.';
        }
        return error.message;
    }

    return 'Ocurrió un error inesperado';
}

/**
 * Reporta error crítico con contexto adicional
 */
export function reportCriticalError(error: Error, context?: Record<string, unknown>): void {
    logger.error('CRITICAL ERROR', error, {
        ...context,
        severity: 'critical',
        timestamp: new Date().toISOString(),
    });

    // En producción, aquí se debe:
    // 1. Enviar alerta a equipo de desarrollo
    // 2. Guardar en sistema de monitoreo
    // 3. Posiblemente mostrar página de error

    if (import.meta.env.PROD) {
        // Enviar a servicio de monitoreo
        // sendToMonitoringService(error, context);

        // Podría también trigger un email o notificación push
        // notifyDevelopmentTeam(error, context);
    }
}

// ==================== HOOKS DE REACT ====================

interface UseErrorHandlerOptions {
    autoClearMs?: number; // Auto-clear error después de X ms
    onError?: (error: AppError) => void; // Callback cuando ocurre un error
}

/**
 * Hook para manejo de errores en componentes
 * Con auto-cleanup y callbacks personalizables
 */
export function useErrorHandler(options: UseErrorHandlerOptions = {}) {
    const [error, setError] = useState<AppError | null>(null);
    const autoClearTimerRef = useRef<NodeJS.Timeout>();

    const handleError = useCallback((err: unknown) => {
        const appError = normalizeError(err);
        setError(appError);
        logger.error(appError.message, err);

        // Callback personalizado
        options.onError?.(appError);

        // Auto-clear si está configurado
        if (options.autoClearMs) {
            if (autoClearTimerRef.current) {
                clearTimeout(autoClearTimerRef.current);
            }

            autoClearTimerRef.current = setTimeout(() => {
                setError(null);
            }, options.autoClearMs);
        }
    }, [options]);

    const clearError = useCallback(() => {
        setError(null);

        if (autoClearTimerRef.current) {
            clearTimeout(autoClearTimerRef.current);
            autoClearTimerRef.current = undefined;
        }
    }, []);

    // Cleanup en unmount
    useEffect(() => {
        return () => {
            if (autoClearTimerRef.current) {
                clearTimeout(autoClearTimerRef.current);
            }
        };
    }, []);

    return {
        error,
        handleError,
        clearError,
        hasError: error !== null,
    };
}

/**
 * Hook avanzado con retry logic
 */
export function useErrorBoundary(maxRetries: number = 3) {
    const [error, setError] = useState<AppError | null>(null);
    const [retryCount, setRetryCount] = useState(0);

    const handleError = useCallback((err: unknown) => {
        const appError = normalizeError(err);
        setError(appError);
        logger.error(appError.message, err, { retryCount });
    }, [retryCount]);

    const retry = useCallback(() => {
        if (retryCount < maxRetries) {
            setRetryCount(prev => prev + 1);
            setError(null);
        }
    }, [retryCount, maxRetries]);

    const reset = useCallback(() => {
        setError(null);
        setRetryCount(0);
    }, []);

    return {
        error,
        handleError,
        retry,
        reset,
        canRetry: retryCount < maxRetries,
        retryCount,
    };
}
