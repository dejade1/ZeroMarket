/**
 * ARCHIVO NUEVO: utils/errorHandler.ts
 * 
 * Sistema centralizado de manejo de errores
 * 
 * CARACTERÍSTICAS:
 * ✅ Clases de error personalizadas
 * ✅ Logging centralizado
 * ✅ Manejo consistente de errores
 * ✅ Tipos TypeScript estrictos
 * ✅ Stack traces para debugging
 */

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

// ==================== CLASES DE ERROR ====================

/**
 * Clase base para errores de aplicación
 */
export class AppError extends Error {
    public readonly code: ErrorCode;
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly timestamp: string;
    public readonly context?: Record<string, unknown>;

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
        this.timestamp = new Date().toISOString();
        this.context = context;

        // Mantiene el stack trace correcto
        Error.captureStackTrace(this, this.constructor);
    }

    /**
     * Convierte el error a un objeto JSON
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            timestamp: this.timestamp,
            context: this.context,
            stack: process.env.NODE_ENV === 'development' ? this.stack : undefined,
        };
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
    timestamp: string;
    context?: Record<string, unknown>;
    error?: Error;
}

/**
 * Logger centralizado
 */
class Logger {
    private logs: LogEntry[] = [];
    private maxLogs: number = 1000;

    /**
     * Log genérico
     */
    private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error) {
        const entry: LogEntry = {
            level,
            message,
            timestamp: new Date().toISOString(),
            context,
            error,
        };

        this.logs.push(entry);

        // Mantener solo los últimos N logs
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        // Console output basado en nivel
        const consoleMessage = `[${entry.timestamp}] [${level}] ${message}`;

        switch (level) {
            case LogLevel.DEBUG:
                console.debug(consoleMessage, context);
                break;
            case LogLevel.INFO:
                console.info(consoleMessage, context);
                break;
            case LogLevel.WARN:
                console.warn(consoleMessage, context);
                break;
            case LogLevel.ERROR:
                console.error(consoleMessage, context, error);
                break;
        }

        // En producción, aquí se enviarían los logs a un servicio externo
        // como Sentry, LogRocket, DataDog, etc.
        if (process.env.NODE_ENV === 'production' && level === LogLevel.ERROR) {
            this.sendToExternalService(entry);
        }
    }

    debug(message: string, context?: Record<string, unknown>) {
        this.log(LogLevel.DEBUG, message, context);
    }

    info(message: string, context?: Record<string, unknown>) {
        this.log(LogLevel.INFO, message, context);
    }

    warn(message: string, context?: Record<string, unknown>) {
        this.log(LogLevel.WARN, message, context);
    }

    error(message: string, error?: Error, context?: Record<string, unknown>) {
        this.log(LogLevel.ERROR, message, context, error);
    }

    /**
     * Obtiene todos los logs
     */
    getLogs(): LogEntry[] {
        return [...this.logs];
    }

    /**
     * Limpia los logs
     */
    clearLogs() {
        this.logs = [];
    }

    /**
     * Envía logs a servicio externo (placeholder)
     */
    private sendToExternalService(entry: LogEntry) {
        // TODO: Implementar integración con servicio de logging
        // Ejemplos: Sentry, LogRocket, DataDog, CloudWatch

        // Ejemplo con Sentry:
        // if (window.Sentry) {
        //   window.Sentry.captureException(entry.error, {
        //     level: 'error',
        //     extra: entry.context,
        //   });
        // }
    }
}

export const logger = new Logger();

// ==================== MANEJADOR DE ERRORES ====================

/**
 * Convierte cualquier error en AppError
 */
export function handleError(error: unknown): AppError {
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
            false
        );
    }

    // Si es un string
    if (typeof error === 'string') {
        logger.error('String error', new Error(error));
        return new AppError(error, ErrorCode.UNKNOWN_ERROR);
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
 * Maneja errores de forma asíncrona
 */
export async function handleAsyncError<T>(
    promise: Promise<T>,
    errorMessage?: string
): Promise<[AppError | null, T | null]> {
    try {
        const data = await promise;
        return [null, data];
    } catch (error) {
        const appError = handleError(error);
        if (errorMessage) {
            appError.message = errorMessage;
        }
        return [appError, null];
    }
}

/**
 * Wrapper para funciones que pueden lanzar errores
 */
export function tryCatch<T extends (...args: any[]) => any>(
    fn: T,
    errorMessage?: string
): (...args: Parameters<T>) => ReturnType<T> | AppError {
    return (...args: Parameters<T>) => {
        try {
            return fn(...args);
        } catch (error) {
            const appError = handleError(error);
            if (errorMessage) {
                appError.message = errorMessage;
            }
            logger.error(appError.message, error as Error);
            return appError;
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
        if (process.env.NODE_ENV === 'production') {
            return 'Ocurrió un error. Por favor, intenta nuevamente.';
        }
        return error.message;
    }

    return 'Ocurrió un error inesperado';
}

/**
 * Reporta error crítico
 */
export function reportCriticalError(error: Error, context?: Record<string, unknown>) {
    logger.error('CRITICAL ERROR', error, context);

    // En producción, aquí se debe:
    // 1. Enviar alerta a equipo de desarrollo
    // 2. Guardar en sistema de monitoreo
    // 3. Posiblemente mostrar página de error

    if (process.env.NODE_ENV === 'production') {
        // Enviar a servicio de monitoreo
        // sendToMonitoringService(error, context);
    }
}

// ==================== HOOKS DE REACT ====================

/**
 * Hook para manejo de errores en componentes
 */
export function useErrorHandler() {
    const [error, setError] = useState<AppError | null>(null);

    const handleError = useCallback((err: unknown) => {
        const appError = handleError(err);
        setError(appError);
        logger.error(appError.message, err as Error);
    }, []);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return {
        error,
        handleError,
        clearError,
        hasError: error !== null,
    };
}

// ==================== EXPORTACIONES ====================

export {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    DatabaseError,
    NetworkError,
};

/**
 * ==================== EJEMPLO DE USO ====================
 * 
 * // En un componente:
 * import { useErrorHandler, ValidationError } from './utils/errorHandler';
 * 
 * function MyComponent() {
 *   const { error, handleError, clearError } = useErrorHandler();
 * 
 *   async function submitForm() {
 *     try {
 *       if (!isValid) {
 *         throw new ValidationError('Datos inválidos', { field: 'email' });
 *       }
 *       await api.submit(data);
 *     } catch (err) {
 *       handleError(err);
 *     }
 *   }
 * 
 *   return (
 *     <div>
 *       {error && <ErrorMessage error={error} onClose={clearError} />}
 *       <button onClick={submitForm}>Submit</button>
 *     </div>
 *   );
 * }
 * 
 * // En un servicio:
 * import { handleAsyncError, DatabaseError } from './utils/errorHandler';
 * 
 * async function getUser(id: number) {
 *   const [error, user] = await handleAsyncError(
 *     db.users.findById(id),
 *     'Error al obtener usuario'
 *   );
 * 
 *   if (error) {
 *     throw new DatabaseError(error.message);
 *   }
 * 
 *   return user;
 * }
 */
