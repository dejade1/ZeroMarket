/**
 * Servicio de Autenticación Frontend
 * Maneja la comunicación con el backend para login, registro y gestión de sesión.
 */

// URL base del API (ajustar según entorno)
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// 🐞 DEBUG: Verificar que el archivo se carga
console.log('🔥 auth-service.ts LOADED - API_URL:', API_URL);

// Tipos
export interface User {
    id: number;
    username: string;
    email: string;
    isAdmin: boolean;
}

export interface AuthResponse {
    user: User;
    message: string;
}

export const authService = {
    /**
     * Iniciar sesión
     */
    async login(username: string, password: string): Promise<User> {
        const fullUrl = `${API_URL}/auth/login`;
        console.log('🔍 [LOGIN] Calling:', fullUrl);
        
        const response = await fetch(fullUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include', // ✅ IMPORTANTE: Envía cookies httpOnly
            body: JSON.stringify({ username, password }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al iniciar sesión');
        }

        const data: AuthResponse = await response.json();
        return data.user;
    },

    /**
     * Registrar nuevo usuario
     */
    async register(username: string, email: string, password: string, isAdmin?: boolean): Promise<User> {
        const fullUrl = `${API_URL}/auth/register`;
        console.log('🔍 [REGISTER] Calling:', fullUrl);
        
        const response = await fetch(fullUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include', // ✅ IMPORTANTE: Envía cookies httpOnly
            body: JSON.stringify({ username, email, password, isAdmin: isAdmin || false }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al registrar usuario');
        }

        const data: AuthResponse = await response.json();
        return data.user;
    },

    /**
     * Cerrar sesión
     */
    async logout(): Promise<void> {
        const fullUrl = `${API_URL}/auth/logout`;
        console.log('🔍 [LOGOUT] Calling:', fullUrl);
        
        const response = await fetch(fullUrl, {
            method: 'POST',
            credentials: 'include', // ✅ IMPORTANTE: Envía cookies httpOnly
        });

        if (!response.ok) {
            console.error('Error al cerrar sesión en el servidor');
        }
    },

    /**
     * Verificar estado de autenticación (Session Check)
     * Útil para persistir sesión al recargar página
     */
    async checkAuth(): Promise<User | null> {
        try {
            const fullUrl = `${API_URL}/auth/me`;
            console.log('🔍 [CHECK_AUTH] Calling:', fullUrl);
            
            const response = await fetch(fullUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include', // ✅ IMPORTANTE: Envía cookies httpOnly
            });

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            return data.user;
        } catch (error) {
            return null;
        }
    },
};

// Force HMR
if (import.meta.hot) {
    import.meta.hot.accept();
}
