import { ReactNode, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { AdminLogin } from './AdminLogin';

interface ProtectedRouteProps {
    children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { isAuthenticated, isLoading } = useAuth();
    const [showLogin, setShowLogin] = useState(true);

    if (isLoading) {
        return <div className="flex items-center justify-center min-h-screen">Cargando...</div>;
    }

    if (!isAuthenticated) {
        // Si no está autenticado, mostramos el login
        // Nota: AdminLogin tiene un botón de cerrar (onClose), pero aquí queremos que sea persistente
        // o redirija al home si se cierra.
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center">
                <AdminLogin onClose={() => window.location.href = '/'} />
            </div>
        );
    }

    return <>{children}</>;
}
