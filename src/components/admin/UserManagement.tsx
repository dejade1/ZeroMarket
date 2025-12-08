import React, { useState, useEffect } from 'react';
import { Trash2, UserPlus, RefreshCw } from 'lucide-react';
import { authService } from '../../lib/auth-service';

interface User {
  username: string;
  email: string;
  isAdmin: boolean;
  id: string;
  createdAt?: string;
}

export function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', isAdmin: false });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      // Intentar cargar desde el backend
      const response = await fetch('http://localhost:3000/api/users', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const backendUsers = await response.json();
        setUsers(backendUsers);
        console.log('[UserManagement] Usuarios cargados desde backend:', backendUsers.length);
      } else {
        // Si falla el backend, cargar desde localStorage como fallback
        console.warn('[UserManagement] Backend no disponible, usando localStorage');
        const storedUsers = JSON.parse(localStorage.getItem('app_users') || '[]');
        const usersWithIds = storedUsers.map((user: User) => ({
          ...user,
          id: user.id || crypto.randomUUID()
        }));
        setUsers(usersWithIds);
      }
    } catch (error) {
      console.error('[UserManagement] Error al cargar usuarios:', error);
      // Fallback a localStorage
      const storedUsers = JSON.parse(localStorage.getItem('app_users') || '[]');
      const usersWithIds = storedUsers.map((user: User) => ({
        ...user,
        id: user.id || crypto.randomUUID()
      }));
      setUsers(usersWithIds);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      if (!newUser.username || !newUser.email || !newUser.password) {
        setError('Todos los campos son obligatorios');
        return;
      }

      if (newUser.password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres');
        return;
      }

      // Intentar crear usuario en el backend
      try {
        await authService.register(newUser.username, newUser.email, newUser.password, newUser.isAdmin);
        setSuccess('Usuario creado exitosamente en el servidor');
      } catch (backendError) {
        console.warn('[UserManagement] Backend no disponible, usando localStorage');

        // Fallback a localStorage
        const storedUsers = JSON.parse(localStorage.getItem('app_users') || '[]');

        if (storedUsers.some((u: User) => u.username === newUser.username)) {
          setError('El nombre de usuario ya existe');
          return;
        }

        if (storedUsers.some((u: User) => u.email === newUser.email)) {
          setError('El email ya está registrado');
          return;
        }

        if (newUser.isAdmin && storedUsers.filter((u: User) => u.isAdmin).length >= 5) {
          setError('Máximo número de administradores alcanzado (5)');
          return;
        }

        const newUserWithId = {
          username: newUser.username,
          email: newUser.email,
          isAdmin: newUser.isAdmin,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString()
        };

        storedUsers.push(newUserWithId);
        localStorage.setItem('app_users', JSON.stringify(storedUsers));
        setSuccess('Usuario creado exitosamente (modo local)');
      }

      setNewUser({ username: '', email: '', password: '', isAdmin: false });
      await loadUsers();

      setTimeout(() => {
        setSuccess('');
      }, 3000);

    } catch (err) {
      console.error('Error al crear usuario:', err);
      setError(err instanceof Error ? err.message : 'Error al crear el usuario');
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('¿Estás seguro de que deseas eliminar este usuario?')) {
      return;
    }

    try {
      // Intentar eliminar del backend
      try {
        const response = await fetch(`http://localhost:3000/api/users/${userId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          setSuccess('Usuario eliminado del servidor');
        } else {
          throw new Error('Backend no disponible');
        }
      } catch (backendError) {
        console.warn('[UserManagement] Backend no disponible, usando localStorage');

        // Fallback a localStorage
        const storedUsers = JSON.parse(localStorage.getItem('app_users') || '[]');
        const updatedUsers = storedUsers.filter((u: User) => u.id !== userId);
        localStorage.setItem('app_users', JSON.stringify(updatedUsers));
        setSuccess('Usuario eliminado (modo local)');
      }

      await loadUsers();

      setTimeout(() => {
        setSuccess('');
      }, 3000);

    } catch (err) {
      console.error('Error al eliminar usuario:', err);
      setError('Error al eliminar el usuario');
      setTimeout(() => {
        setError('');
      }, 3000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white shadow px-4 py-5 sm:rounded-lg sm:p-6">
        <div className="md:grid md:grid-cols-3 md:gap-6">
          <div className="md:col-span-1">
            <h3 className="text-lg font-medium leading-6 text-gray-900">Nuevo Usuario</h3>
            <p className="mt-1 text-sm text-gray-500">
              Crear una nueva cuenta de usuario en el sistema.
            </p>
          </div>
          <div className="mt-5 md:mt-0 md:col-span-2">
            <form onSubmit={handleSubmit}>
              {error && (
                <div className="mb-4 bg-red-50 text-red-500 p-3 rounded-md text-sm">
                  {error}
                </div>
              )}
              {success && (
                <div className="mb-4 bg-green-50 text-green-500 p-3 rounded-md text-sm">
                  {success}
                </div>
              )}
              <div className="grid grid-cols-6 gap-6">
                <div className="col-span-6 sm:col-span-4">
                  <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                    Usuario
                  </label>
                  <input
                    type="text"
                    name="username"
                    id="username"
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                    required
                  />
                </div>

                <div className="col-span-6 sm:col-span-4">
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    type="email"
                    name="email"
                    id="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                    required
                  />
                </div>

                <div className="col-span-6 sm:col-span-4">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    name="password"
                    id="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                    required
                    minLength={6}
                  />
                </div>

                <div className="col-span-6 sm:col-span-4">
                  <div className="flex items-center">
                    <input
                      id="isAdmin"
                      name="isAdmin"
                      type="checkbox"
                      checked={newUser.isAdmin}
                      onChange={(e) => setNewUser({ ...newUser, isAdmin: e.target.checked })}
                      className="h-4 w-4 text-yellow-600 focus:ring-yellow-500 border-gray-300 rounded"
                    />
                    <label htmlFor="isAdmin" className="ml-2 block text-sm text-gray-900">
                      Usuario Administrador
                    </label>
                  </div>
                </div>
              </div>
              <div className="mt-5">
                <button
                  type="submit"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-gray-900 bg-yellow-400 hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                >
                  <UserPlus className="h-5 w-5 mr-2" />
                  Crear Usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              Usuarios Registrados ({users.length})
            </h3>
            <button
              onClick={loadUsers}
              disabled={loading}
              className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>

        <div className="px-4 py-5 sm:p-6">
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8">
              <UserPlus className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No hay usuarios</h3>
              <p className="mt-1 text-sm text-gray-500">
                Comienza creando un nuevo usuario.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
                <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
                  <div className="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Usuario
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Email
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Rol
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Fecha de Registro
                          </th>
                          <th scope="col" className="relative px-6 py-3">
                            <span className="sr-only">Acciones</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {users.map((user) => (
                          <tr key={user.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {user.username}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {user.email}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                user.isAdmin
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-green-100 text-green-800'
                              }`}>
                                {user.isAdmin ? 'Administrador' : 'Usuario'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {user.createdAt
                                ? new Date(user.createdAt).toLocaleDateString('es-ES', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric'
                                  })
                                : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <button
                                onClick={() => handleDelete(user.id)}
                                className="text-red-600 hover:text-red-900"
                                title="Eliminar usuario"
                              >
                                <Trash2 className="h-5 w-5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}