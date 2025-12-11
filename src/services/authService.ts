import { ValidationError, NetworkError, AuthenticationError } from '../utils/errorHandler';
import { sanitizeString, sanitizeEmail } from '../utils/validation';

// ⚠️ TEMPORAL: URLs hardcodeadas para debugging
const API_BASE = 'http://localhost:3000/api';
const REQUEST_TIMEOUT = 10000;

export interface LoginCredentials {
    username: string;
    password: string;
}

export interface User {
    id: number;
    username: string;
    email: string;
    isAdmin: boolean;
}

class AuthService {
    private async request<T>(
        endpoint: string,
        options: RequestInit = {}
    ): Promise<T> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        // 🐞 DEBUG: Log de la URL completa
        const fullUrl = `${API_BASE}${endpoint}`;
        console.log('🔍 [DEBUG] Calling:', fullUrl);

        try {
            const response = await fetch(fullUrl, {
                ...options,
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: 'Error desconocido' }));

                if (response.status === 401) {
                    throw new AuthenticationError(error.error || 'Credenciales inválidas');
                }

                if (response.status === 400) {
                    throw new ValidationError(error.error || 'Datos inválidos');
                }

                if (response.status === 403) {
                    throw new AuthenticationError('No tienes permisos para realizar esta acción');
                }

                throw new Error(error.error || 'Error en la petición al servidor');
            }

            return response.json();

        } catch (error) {
            clearTimeout(timeoutId);

            if (error instanceof AuthenticationError || error instanceof ValidationError) {
                throw error;
            }

            if (error instanceof TypeError || (error as Error).name === 'AbortError') {
                throw new NetworkError('No se pudo conectar con el servidor. Verifica que el backend esté corriendo.');
            }

            throw error;
        }
    }

    async login(credentials: LoginCredentials): Promise<{ user: User }> {
        return this.request<{ user: User }>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                username: sanitizeString(credentials.username),
                password: credentials.password,
            }),
        });
    }

    async register(username: string, email: string, password: string): Promise<{ user: User }> {
        return this.request<{ user: User }>('/auth/register', {
            method: 'POST',
            body: JSON.stringify({
                username: sanitizeString(username),
                email: sanitizeEmail(email),
                password: password,
            }),
        });
    }

    async logout(): Promise<void> {
        await this.request('/auth/logout', {
            method: 'POST',
        });
    }

    async getCurrentUser(): Promise<User | null> {
        try {
            const data = await this.request<{ user: User }>('/auth/me');
            return data.user;
        } catch (error) {
            if (error instanceof AuthenticationError) {
                return null;
            }
            console.error('Error fetching current user:', error);
            return null;
        }
    }

    async refreshToken(): Promise<void> {
        await this.request('/auth/refresh', {
            method: 'POST',
        });
    }
}

export const authService = new AuthService();
