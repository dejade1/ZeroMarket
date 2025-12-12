import React, { useState, useEffect } from 'react';
import { Trash2, UserPlus, RefreshCw, Users, Shield } from 'lucide-react';
import { authService } from '../../lib/auth-service';

// ✅ ACTUALIZADO: interface con role
interface User {
  username: string;
  email: string;
  role: 'ADMIN' | 'USER' | 'CLIENT';
  id: string;
  createdAt?: string;
  loyaltyPoints?: number;
}

type RoleFilter = 'ALL' | 'CLIENTS' | 'STAFF';

export function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [newUser, setNewUser] = useState({ 
    username: '', 
    email: '', 
    password: '', 
    role: 'CLIENT' as 'ADMIN' | 'USER' | 'CLIENT' 
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      // ✅ FIX: Cambiar endpoint a /api/admin/users
      const response = await fetch('http://localhost:3000/api/admin/users', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        // ✅ El backend devuelve { users: [...] }
        const backendUsers = data.users || data;
        setUsers(backendUsers);
        console.log('[UserManagement] Usuarios cargados desde backend:', backendUsers.length);
      } else {
        console.warn('[UserManagement] Backend no disponible, usando localStorage');
        const storedUsers = JSON.parse(localStorage.getItem('app_users') || '[]');
        const usersWithIds = storedUsers.map((user: any) => ({
          ...user,
          id: user.id || crypto.randomUUID(),
          role: user.role || (user.isAdmin ? 'ADMIN' : 'CLIENT') // Migrar isAdmin a role
        }));
        setUsers(usersWithIds);
      }
    } catch (error) {
      console.error('[UserManagement] Error al cargar usuarios:', error);
      const storedUsers = JSON.parse(localStorage.getItem('app_users') || '[]');
      const usersWithIds = storedUsers.map((user: any) => ({
        ...user,
        id: user.id || crypto.randomUUID(),
        role: user.role || (user.isAdmin ? 'ADMIN' : 'CLIENT')
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

      try {
        // Enviar role al backend
        const response = await fetch('http://localhost:3000/api/auth/register', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username: newUser.username,
            email: newUser.email,
            password: newUser.password,
            role: newUser.role // ✅ Enviar role
          })
        });

        if (response.ok) {
          setSuccess('Usuario creado exitosamente en el servidor');
        } else {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Error al crear usuario');
        }
      } catch (backendError) {
        console.warn('[UserManagement] Backend no disponible, usando localStorage');

        const storedUsers = JSON.parse(localStorage.getItem('app_users') || '[]');

        if (storedUsers.some((u: User) => u.username === newUser.username)) {
          setError('El nombre de usuario ya existe');
          return;
        }

        if (storedUsers.some((u: User) => u.email === newUser.email)) {
          setError('El email ya está registrado');
          return;
        }

        const newUserWithId = {
          username: newUser.username,
          email: newUser.email,
          role: newUser.role,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          loyaltyPoints: 0
        };

        storedUsers.push(newUserWithId);
        localStorage.setItem('app_users', JSON.stringify(storedUsers));
        setSuccess('Usuario creado exitosamente (modo local)');
      }

      setNewUser({ username: '', email: '', password: '', role: 'CLIENT' });
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

  // ✅ NUEVO: Función para obtener colores por rol
  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return 'bg-purple-100 text-purple-800';
      case 'USER':
        return 'bg-orange-100 text-orange-800';
      case 'CLIENT':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // ✅ NUEVO: Función para obtener nombre legible del rol
  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return 'Administrador';
      case 'USER':
        return 'Usuario';
      case 'CLIENT':
        return 'Cliente';
      default:
        return role;
    }
  };

  // ✅ NUEVO: Filtrar usuarios según el filtro seleccionado
  const filteredUsers = users.filter(user => {
    if (roleFilter === 'ALL') return true;
    if (roleFilter === 'CLIENTS') return user.role === 'CLIENT';
    if (roleFilter === 'STAFF') return user.role === 'ADMIN' || user.role === 'USER';
    return true;
  });

  // Calcular estadísticas
  const clientsCount = users.filter(u => u.role === 'CLIENT').length;
  const staffCount = users.filter(u => u.role === 'ADMIN' || u.role === 'USER').length;

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

                {/* ✅ Dropdown para rol */}
                <div className="col-span-6 sm:col-span-4">
                  <label htmlFor="role" className="block text-sm font-medium text-gray-700">
                    Tipo de Usuario
                  </label>
                  <select
                    id="role"
                    name="role"
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as 'ADMIN' | 'USER' | 'CLIENT' })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                  >
                    <option value="CLIENT">Cliente</option>
                    <option value="USER">Usuario</option>
                    <option value="ADMIN">Administrador</option>
                  </select>
                  <p className="mt-2 text-sm text-gray-500">
                    <span className="font-medium">Administrador:</span> Acceso total al panel. 
                    <span className="font-medium ml-2">Usuario:</span> Acceso total al panel. 
                    <span className="font-medium ml-2">Cliente:</span> Solo compras.
                  </p>
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-3 sm:space-y-0">
            <div>
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Usuarios Registrados ({filteredUsers.length})
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {clientsCount} clientes • {staffCount} personal
              </p>
            </div>
            <div className="flex items-center space-x-3">
              {/* ✅ NUEVO: Filtro de roles */}
              <div className="flex items-center space-x-2 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setRoleFilter('ALL')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    roleFilter === 'ALL'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setRoleFilter('CLIENTS')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center space-x-1 ${
                    roleFilter === 'CLIENTS'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Users className="h-4 w-4" />
                  <span>Clientes</span>
                </button>
                <button
                  onClick={() => setRoleFilter('STAFF')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center space-x-1 ${
                    roleFilter === 'STAFF'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Shield className="h-4 w-4" />
                  <span>Personal</span>
                </button>
              </div>

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
        </div>

        <div className="px-4 py-5 sm:p-6">
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8">
              <UserPlus className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No hay usuarios</h3>
              <p className="mt-1 text-sm text-gray-500">
                {roleFilter === 'ALL' 
                  ? 'Comienza creando un nuevo usuario.'
                  : `No hay ${roleFilter === 'CLIENTS' ? 'clientes' : 'personal'} registrados.`}
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
                            Puntos
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
                        {filteredUsers.map((user) => (
                          <tr key={user.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {user.username}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {user.email}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                getRoleBadgeClass(user.role)
                              }`}>
                                {getRoleLabel(user.role)}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {user.role === 'CLIENT' ? (
                                <span className="font-medium text-yellow-600">{user.loyaltyPoints || 0}</span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
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