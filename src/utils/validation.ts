/**
 * ARCHIVO NUEVO: utils/validation.ts
 * 
 * Sistema de validación y sanitización de datos
 * 
 * CARACTERÍSTICAS:
 * ✅ Validación robusta de inputs
 * ✅ Sanitización contra XSS
 * ✅ Validación de tipos en runtime
 * ✅ Schemas reutilizables
 * ✅ Mensajes de error descriptivos
 */

import { ValidationError } from './errorHandler';

// ==================== CONSTANTES ====================

export const VALIDATION_RULES = {
    // Usuario
    USERNAME_MIN_LENGTH: 3,
    USERNAME_MAX_LENGTH: 50,
    USERNAME_PATTERN: /^[a-zA-Z0-9_-]+$/,

    // Email
    EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    EMAIL_MAX_LENGTH: 254,

    // Contraseña
    PASSWORD_MIN_LENGTH: 8,
    PASSWORD_MAX_LENGTH: 128,
    PASSWORD_REQUIRE_UPPERCASE: true,
    PASSWORD_REQUIRE_LOWERCASE: true,
    PASSWORD_REQUIRE_NUMBER: true,
    PASSWORD_REQUIRE_SPECIAL: true,
    PASSWORD_SPECIAL_CHARS: '!@#$%^&*(),.?":{}|<>',

    // Números
    PRICE_MIN: 0,
    PRICE_MAX: 1000000,
    QUANTITY_MIN: 0,
    QUANTITY_MAX: 10000,

    // Texto
    TEXT_MAX_LENGTH: 1000,
    DESCRIPTION_MAX_LENGTH: 5000,

    // URLs
    URL_PATTERN: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
} as const;

export const ERROR_MESSAGES = {
    REQUIRED_FIELD: 'Este campo es obligatorio',
    INVALID_EMAIL: 'Email inválido',
    INVALID_USERNAME: 'Usuario inválido. Solo letras, números, guiones y guiones bajos',
    USERNAME_TOO_SHORT: `El usuario debe tener al menos ${VALIDATION_RULES.USERNAME_MIN_LENGTH} caracteres`,
    USERNAME_TOO_LONG: `El usuario no puede tener más de ${VALIDATION_RULES.USERNAME_MAX_LENGTH} caracteres`,
    WEAK_PASSWORD: 'La contraseña debe tener al menos 8 caracteres, incluir mayúsculas, minúsculas, números y símbolos',
    PASSWORD_TOO_SHORT: `La contraseña debe tener al menos ${VALIDATION_RULES.PASSWORD_MIN_LENGTH} caracteres`,
    PASSWORD_TOO_LONG: `La contraseña no puede tener más de ${VALIDATION_RULES.PASSWORD_MAX_LENGTH} caracteres`,
    INVALID_NUMBER: 'Debe ser un número válido',
    NUMBER_TOO_SMALL: 'El valor es demasiado pequeño',
    NUMBER_TOO_LARGE: 'El valor es demasiado grande',
    INVALID_URL: 'URL inválida',
    TEXT_TOO_LONG: 'El texto es demasiado largo',
    INVALID_DATE: 'Fecha inválida',
    DATE_IN_PAST: 'La fecha no puede estar en el pasado',
    DATE_IN_FUTURE: 'La fecha no puede estar en el futuro',
} as const;

// ==================== TIPOS ====================

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

export interface FieldValidation {
    value: unknown;
    fieldName: string;
    rules: ValidationRule[];
}

export type ValidationRule =
    | 'required'
    | 'email'
    | 'username'
    | 'password'
    | 'number'
    | 'positiveNumber'
    | 'url'
    | 'date'
    | 'futureDate'
    | 'pastDate'
    | { minLength: number }
    | { maxLength: number }
    | { min: number }
    | { max: number }
    | { pattern: RegExp }
    | { custom: (value: unknown) => boolean | string };

// ==================== SANITIZACIÓN ====================

/**
 * Sanitiza string para prevenir XSS
 */
export function sanitizeString(input: string): string {
    if (typeof input !== 'string') {
        return '';
    }

    return input
        .trim()
        // Elimina caracteres peligrosos
        .replace(/[<>]/g, '')
        // Elimina scripts
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        // Elimina eventos inline
        .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
        // Elimina javascript: URLs
        .replace(/javascript:/gi, '')
        // Normaliza espacios
        .replace(/\s+/g, ' ');
}

/**
 * Sanitiza HTML permitiendo solo tags seguros
 */
export function sanitizeHTML(html: string): string {
    const allowedTags = ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li'];
    const div = document.createElement('div');
    div.innerHTML = html;

    // Elimina todos los tags no permitidos
    const allElements = div.getElementsByTagName('*');
    for (let i = allElements.length - 1; i >= 0; i--) {
        const element = allElements[i];
        if (!allowedTags.includes(element.tagName.toLowerCase())) {
            element.remove();
        }
    }

    return div.innerHTML;
}

/**
 * Sanitiza número
 */
export function sanitizeNumber(input: unknown): number | null {
    if (typeof input === 'number' && !isNaN(input) && isFinite(input)) {
        return input;
    }

    if (typeof input === 'string') {
        const num = parseFloat(input);
        if (!isNaN(num) && isFinite(num)) {
            return num;
        }
    }

    return null;
}

/**
 * Sanitiza email
 */
export function sanitizeEmail(email: string): string {
    return sanitizeString(email).toLowerCase();
}

/**
 * Sanitiza URL
 */
export function sanitizeURL(url: string): string {
    try {
        const urlObj = new URL(url);
        // Solo permite http y https
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
            return '';
        }
        return urlObj.href;
    } catch {
        return '';
    }
}

// ==================== VALIDACIÓN ====================

/**
 * Valida si un valor no está vacío
 */
export function isRequired(value: unknown): boolean {
    if (value === null || value === undefined) {
        return false;
    }

    if (typeof value === 'string') {
        return value.trim().length > 0;
    }

    if (Array.isArray(value)) {
        return value.length > 0;
    }

    return true;
}

/**
 * Valida formato de email
 */
export function isValidEmail(email: string): boolean {
    if (typeof email !== 'string') {
        return false;
    }

    if (email.length > VALIDATION_RULES.EMAIL_MAX_LENGTH) {
        return false;
    }

    return VALIDATION_RULES.EMAIL_PATTERN.test(email);
}

/**
 * Valida formato de username
 */
export function isValidUsername(username: string): boolean {
    if (typeof username !== 'string') {
        return false;
    }

    if (username.length < VALIDATION_RULES.USERNAME_MIN_LENGTH) {
        return false;
    }

    if (username.length > VALIDATION_RULES.USERNAME_MAX_LENGTH) {
        return false;
    }

    return VALIDATION_RULES.USERNAME_PATTERN.test(username);
}

/**
 * Valida fortaleza de contraseña
 */
export function isStrongPassword(password: string): boolean {
    if (typeof password !== 'string') {
        return false;
    }

    if (password.length < VALIDATION_RULES.PASSWORD_MIN_LENGTH) {
        return false;
    }

    if (password.length > VALIDATION_RULES.PASSWORD_MAX_LENGTH) {
        return false;
    }

    const checks = {
        hasUpperCase: /[A-Z]/.test(password),
        hasLowerCase: /[a-z]/.test(password),
        hasNumber: /\d/.test(password),
        hasSpecial: new RegExp(`[${VALIDATION_RULES.PASSWORD_SPECIAL_CHARS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`).test(password),
    };

    return (
        (!VALIDATION_RULES.PASSWORD_REQUIRE_UPPERCASE || checks.hasUpperCase) &&
        (!VALIDATION_RULES.PASSWORD_REQUIRE_LOWERCASE || checks.hasLowerCase) &&
        (!VALIDATION_RULES.PASSWORD_REQUIRE_NUMBER || checks.hasNumber) &&
        (!VALIDATION_RULES.PASSWORD_REQUIRE_SPECIAL || checks.hasSpecial)
    );
}

/**
 * Obtiene detalles de fortaleza de contraseña
 */
export function getPasswordStrength(password: string): {
    score: number;
    feedback: string[];
} {
    const feedback: string[] = [];
    let score = 0;

    if (password.length >= VALIDATION_RULES.PASSWORD_MIN_LENGTH) {
        score += 1;
    } else {
        feedback.push(`Mínimo ${VALIDATION_RULES.PASSWORD_MIN_LENGTH} caracteres`);
    }

    if (/[A-Z]/.test(password)) {
        score += 1;
    } else {
        feedback.push('Incluye al menos una mayúscula');
    }

    if (/[a-z]/.test(password)) {
        score += 1;
    } else {
        feedback.push('Incluye al menos una minúscula');
    }

    if (/\d/.test(password)) {
        score += 1;
    } else {
        feedback.push('Incluye al menos un número');
    }

    if (new RegExp(`[${VALIDATION_RULES.PASSWORD_SPECIAL_CHARS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`).test(password)) {
        score += 1;
    } else {
        feedback.push('Incluye al menos un símbolo');
    }

    if (password.length >= 12) {
        score += 1;
    }

    return { score, feedback };
}

/**
 * Valida número
 */
export function isValidNumber(value: unknown, min?: number, max?: number): boolean {
    const num = sanitizeNumber(value);

    if (num === null) {
        return false;
    }

    if (min !== undefined && num < min) {
        return false;
    }

    if (max !== undefined && num > max) {
        return false;
    }

    return true;
}

/**
 * Valida URL
 */
export function isValidURL(url: string): boolean {
    if (typeof url !== 'string') {
        return false;
    }

    return VALIDATION_RULES.URL_PATTERN.test(url);
}

/**
 * Valida fecha
 */
export function isValidDate(date: unknown): boolean {
    if (date instanceof Date) {
        return !isNaN(date.getTime());
    }

    if (typeof date === 'string' || typeof date === 'number') {
        const d = new Date(date);
        return !isNaN(d.getTime());
    }

    return false;
}

/**
 * Valida que la fecha sea futura
 */
export function isFutureDate(date: Date | string | number): boolean {
    if (!isValidDate(date)) {
        return false;
    }

    const d = new Date(date);
    return d.getTime() > Date.now();
}

/**
 * Valida que la fecha sea pasada
 */
export function isPastDate(date: Date | string | number): boolean {
    if (!isValidDate(date)) {
        return false;
    }

    const d = new Date(date);
    return d.getTime() < Date.now();
}

// ==================== VALIDADOR GENÉRICO ====================

/**
 * Valida un campo según reglas especificadas
 */
export function validateField(
    value: unknown,
    fieldName: string,
    rules: ValidationRule[]
): ValidationResult {
    const errors: string[] = [];

    for (const rule of rules) {
        if (rule === 'required') {
            if (!isRequired(value)) {
                errors.push(`${fieldName}: ${ERROR_MESSAGES.REQUIRED_FIELD}`);
            }
        } else if (rule === 'email') {
            if (typeof value === 'string' && !isValidEmail(value)) {
                errors.push(`${fieldName}: ${ERROR_MESSAGES.INVALID_EMAIL}`);
            }
        } else if (rule === 'username') {
            if (typeof value === 'string' && !isValidUsername(value)) {
                errors.push(`${fieldName}: ${ERROR_MESSAGES.INVALID_USERNAME}`);
            }
        } else if (rule === 'password') {
            if (typeof value === 'string' && !isStrongPassword(value)) {
                errors.push(`${fieldName}: ${ERROR_MESSAGES.WEAK_PASSWORD}`);
            }
        } else if (rule === 'number') {
            if (!isValidNumber(value)) {
                errors.push(`${fieldName}: ${ERROR_MESSAGES.INVALID_NUMBER}`);
            }
        } else if (rule === 'positiveNumber') {
            if (!isValidNumber(value, 0)) {
                errors.push(`${fieldName}: ${ERROR_MESSAGES.NUMBER_TOO_SMALL}`);
            }
        } else if (rule === 'url') {
            if (typeof value === 'string' && !isValidURL(value)) {
                errors.push(`${fieldName}: ${ERROR_MESSAGES.INVALID_URL}`);
            }
        } else if (rule === 'date') {
            if (!isValidDate(value)) {
                errors.push(`${fieldName}: ${ERROR_MESSAGES.INVALID_DATE}`);
            }
        } else if (rule === 'futureDate') {
            if (!isFutureDate(value as Date)) {
                errors.push(`${fieldName}: ${ERROR_MESSAGES.DATE_IN_PAST}`);
            }
        } else if (rule === 'pastDate') {
            if (!isPastDate(value as Date)) {
                errors.push(`${fieldName}: ${ERROR_MESSAGES.DATE_IN_FUTURE}`);
            }
        } else if (typeof rule === 'object') {
            if ('minLength' in rule && typeof value === 'string') {
                if (value.length < rule.minLength) {
                    errors.push(`${fieldName}: Mínimo ${rule.minLength} caracteres`);
                }
            } else if ('maxLength' in rule && typeof value === 'string') {
                if (value.length > rule.maxLength) {
                    errors.push(`${fieldName}: Máximo ${rule.maxLength} caracteres`);
                }
            } else if ('min' in rule) {
                const num = sanitizeNumber(value);
                if (num !== null && num < rule.min) {
                    errors.push(`${fieldName}: Valor mínimo ${rule.min}`);
                }
            } else if ('max' in rule) {
                const num = sanitizeNumber(value);
                if (num !== null && num > rule.max) {
                    errors.push(`${fieldName}: Valor máximo ${rule.max}`);
                }
            } else if ('pattern' in rule && typeof value === 'string') {
                if (!rule.pattern.test(value)) {
                    errors.push(`${fieldName}: Formato inválido`);
                }
            } else if ('custom' in rule) {
                const result = rule.custom(value);
                if (result === false) {
                    errors.push(`${fieldName}: Validación personalizada falló`);
                } else if (typeof result === 'string') {
                    errors.push(`${fieldName}: ${result}`);
                }
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Valida múltiples campos
 */
export function validateFields(fields: FieldValidation[]): ValidationResult {
    const allErrors: string[] = [];

    for (const field of fields) {
        const result = validateField(field.value, field.fieldName, field.rules);
        allErrors.push(...result.errors);
    }

    return {
        isValid: allErrors.length === 0,
        errors: allErrors,
    };
}

/**
 * Valida y lanza error si falla
 */
export function validateOrThrow(
    value: unknown,
    fieldName: string,
    rules: ValidationRule[]
): void {
    const result = validateField(value, fieldName, rules);

    if (!result.isValid) {
        throw new ValidationError(result.errors.join(', '), {
            field: fieldName,
            errors: result.errors,
        });
    }
}

// ==================== SCHEMAS DE VALIDACIÓN ====================

/**
 * Schema para validación de usuario
 */
export const userValidationSchema = {
    username: ['required', 'username'] as ValidationRule[],
    email: ['required', 'email'] as ValidationRule[],
    password: ['required', 'password'] as ValidationRule[],
};

/**
 * Schema para validación de producto
 */
export const productValidationSchema = {
    title: ['required', { minLength: 3 }, { maxLength: 100 }] as ValidationRule[],
    price: ['required', 'positiveNumber', { min: 0 }, { max: 1000000 }] as ValidationRule[],
    stock: ['required', 'positiveNumber', { min: 0 }] as ValidationRule[],
    description: [{ maxLength: 5000 }] as ValidationRule[],
};
