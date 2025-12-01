import { ValidationError, NetworkError, AuthenticationError } from '../utils/errorHandler';
import { sanitizeString, sanitizeEmail } from '../utils/validation';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
        try {
            const response = await fetch(`${API_URL}${endpoint}`, {
                ...options,
                credentials: 'include', // Importante para cookies httpOnly
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            });

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
            if (error instanceof AuthenticationError || error instanceof ValidationError) {
                throw error;
            }

            if (error instanceof TypeError) {
                // Error de red (fetch falló)
                throw new NetworkError('No se pudo conectar con el servidor. Verifica que el backend esté corriendo en el puerto 3000.');
            }

            throw error;
        }
    }

    async login(credentials: LoginCredentials): Promise<{ user: User }> {
        return this.request<{ user: User }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                username: sanitizeString(credentials.username),
                password: credentials.password,
            }),
        });
    }

    async logout(): Promise<void> {
        await this.request('/api/auth/logout', {
            method: 'POST',
        });
    }

    async getCurrentUser(): Promise<User | null> {
        try {
            const data = await this.request<{ user: User }>('/api/auth/me');
            return data.user;
        } catch {
            return null;
        }
    }
}

export const authService = new AuthService();
