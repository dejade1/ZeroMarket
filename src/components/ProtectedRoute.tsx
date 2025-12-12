import { ReactNode, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { AdminLogin } from './AdminLogin';
import { XCircle } from 'lucide-react';

interface ProtectedRouteProps {
    children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { user, isAuthenticated, isLoading, logout } = useAuth();
    const [showLogin, setShowLogin] = useState(true);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400"></div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center">
                <AdminLogin onClose={() => window.location.href = '/'} />
            </div>
        );
    }

    // ✅ Bloquear acceso a clientes
    if (user && user.role === 'CLIENT') {
        /**
         * Maneja el cambio de cuenta
         * Hace logout completo y redirige al home
         */
        const handleChangeAccount = async () => {
            try {
                await logout();
                // Esperar un poco para asegurar que el logout se completó
                setTimeout(() => {
                    window.location.href = '/';
                }, 100);
            } catch (error) {
                console.error('Error al cerrar sesión:', error);
                // Forzar redirección incluso si hay error
                window.location.href = '/';
            }
        };

        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
                    <div className="flex flex-col items-center text-center">
                        <XCircle className="h-16 w-16 text-red-500 mb-4" />
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">
                            Acceso Denegado
                        </h2>
                        <p className="text-gray-600 mb-6">
                            Esta área es solo para administradores. Tu cuenta de cliente no tiene permisos para acceder al panel de administración.
                        </p>
                        <div className="space-y-3 w-full">
                            <button
                                onClick={() => window.location.href = '/'}
                                className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium py-3 px-4 rounded-lg transition-colors"
                            >
                                Ir a la Tienda
                            </button>
                            <button
                                onClick={handleChangeAccount}
                                className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-3 px-4 rounded-lg transition-colors"
                            >
                                Cambiar de Cuenta
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}