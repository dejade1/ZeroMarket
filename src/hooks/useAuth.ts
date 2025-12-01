import { useState, useEffect, useCallback } from 'react';
import { authService, User, LoginCredentials } from '../services/authService';
import { useErrorHandler } from '../utils/errorHandler';

export function useAuth() {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const { handleError } = useErrorHandler();

    // Cargar usuario al montar el componente
    useEffect(() => {
        loadUser();
    }, []);

    // Configurar refresh token automático
    useEffect(() => {
        if (isAuthenticated) {
            // Refrescar token cada 14 minutos (antes de que expire el de 15 min)
            const interval = setInterval(() => {
                authService.refreshToken().catch(() => {
                    // Si falla el refresh (ej. sesión expirada), hacer logout
                    logout();
                });
            }, 14 * 60 * 1000);

            return () => clearInterval(interval);
        }
    }, [isAuthenticated]);

    const loadUser = async () => {
        try {
            const currentUser = await authService.getCurrentUser();
            if (currentUser) {
                setUser(currentUser);
                setIsAuthenticated(true);
            }
        } catch (error) {
            // Si falla al cargar usuario (ej. 401), no es un error crítico, solo no está logueado
            setUser(null);
            setIsAuthenticated(false);
        } finally {
            setIsLoading(false);
        }
    };

    const login = useCallback(async (credentials: LoginCredentials) => {
        try {
            const { user: loggedUser } = await authService.login(credentials);
            setUser(loggedUser);
            setIsAuthenticated(true);
            return loggedUser;
        } catch (error) {
            handleError(error);
            throw error;
        }
    }, [handleError]);

    const logout = useCallback(async () => {
        try {
            await authService.logout();
        } catch (error) {
            console.error('Error al cerrar sesión:', error);
        } finally {
            setUser(null);
            setIsAuthenticated(false);
            // Opcional: recargar página para limpiar estados
            window.location.href = '/';
        }
    }, []);

    return {
        user,
        isLoading,
        isAuthenticated,
        login,
        logout,
    };
}
