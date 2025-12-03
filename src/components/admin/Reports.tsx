/**
 * COMPONENTE: Reports
 *
 * Panel de reportes y análisis de datos con gráficos
 *
 * CARACTERÍSTICAS:
 * ✅ Reportes de ventas por día/semana/mes/año
 * ✅ Gráfico de productos más vendidos
 * ✅ Exportación a CSV
 * ✅ Estadísticas visuales
 */

import React, { useState, useEffect } from 'react';
import { Download, TrendingUp, DollarSign, Calendar, BarChart3 } from 'lucide-react';
import { db } from '../../lib/db';
import { getAllProducts } from '../../lib/inventory';

interface SalesReport {
  period: string;
  totalSales: number;
  revenue: number;
  orders: number;
}

interface ProductReport {
  id: number;
  name: string;
  sold: number;
  revenue: number;
}

type DateRange = 'day' | 'week' | 'month' | 'year';

export function Reports() {
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [salesData, setSalesData] = useState<SalesReport[]>([]);
  const [topProducts, setTopProducts] = useState<ProductReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalStats, setTotalStats] = useState({
    totalRevenue: 0,
    totalOrders: 0,
    totalUnits: 0,
    averageOrderValue: 0
  });

  useEffect(() => {
    loadReportData();
  }, [dateRange]);

  /**
   * Agrupa fechas según el rango seleccionado
   */
  const groupByPeriod = (date: Date): string => {
    const d = new Date(date);

    switch (dateRange) {
      case 'day':
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
      case 'week':
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        return `Semana del ${weekStart.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}`;
      case 'month':
        return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      case 'year':
        return d.getFullYear().toString();
      default:
        return d.toLocaleDateString('es-ES');
    }
  };

  /**
   * Filtra por rango de fechas
   */
  const isInDateRange = (date: Date): boolean => {
    const now = new Date();
    const orderDate = new Date(date);
    const diffTime = now.getTime() - orderDate.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);

    switch (dateRange) {
      case 'day':
        return diffDays <= 30; // Últimos 30 días
      case 'week':
        return diffDays <= 90; // Últimas 12 semanas
      case 'month':
        return diffDays <= 365; // Últimos 12 meses
      case 'year':
        return diffDays <= 365 * 5; // Últimos 5 años
      default:
        return true;
    }
  };

  /**
   * Carga todos los datos del reporte
   */
  const loadReportData = async () => {
    setLoading(true);
    try {
      const [orders, orderItems, products] = await Promise.all([
        db.orders.toArray(),
        db.orderItems.toArray(),
        getAllProducts()
      ]);

      // Filtrar órdenes por rango de fecha
      const filteredOrders = orders.filter(order => isInDateRange(order.createdAt));

      // Agrupar ventas por período
      const salesByPeriod: { [key: string]: SalesReport } = {};

      filteredOrders.forEach(order => {
        const period = groupByPeriod(order.createdAt);
        if (!salesByPeriod[period]) {
          salesByPeriod[period] = {
            period,
            totalSales: 0,
            revenue: 0,
            orders: 0
          };
        }
        salesByPeriod[period].revenue += order.total;
        salesByPeriod[period].orders += 1;
      });

      // Agregar unidades vendidas
      orderItems.forEach(item => {
        const order = filteredOrders.find(o => o.id === item.orderId);
        if (order) {
          const period = groupByPeriod(order.createdAt);
          if (salesByPeriod[period]) {
            salesByPeriod[period].totalSales += Math.abs(item.quantity);
          }
        }
      });

      setSalesData(Object.values(salesByPeriod).sort((a, b) =>
        a.period.localeCompare(b.period)
      ));

      // Calcular productos más vendidos
      const productSales: { [key: number]: ProductReport } = {};

      orderItems.forEach(item => {
        const order = filteredOrders.find(o => o.id === item.orderId);
        if (order) {
          if (!productSales[item.productId]) {
            const product = products.find(p => p.id === item.productId);
            productSales[item.productId] = {
              id: item.productId,
              name: product?.title || 'Producto desconocido',
              sold: 0,
              revenue: 0
            };
          }
          productSales[item.productId].sold += Math.abs(item.quantity);
          productSales[item.productId].revenue += item.price * Math.abs(item.quantity);
        }
      });

      const sortedProducts = Object.values(productSales)
        .sort((a, b) => b.sold - a.sold);

      setTopProducts(sortedProducts);

      // Calcular estadísticas totales
      const totalRevenue = filteredOrders.reduce((sum, order) => sum + order.total, 0);
      const totalOrders = filteredOrders.length;
      const totalUnits = Object.values(salesByPeriod).reduce((sum, period) => sum + period.totalSales, 0);

      setTotalStats({
        totalRevenue,
        totalOrders,
        totalUnits,
        averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0
      });

    } catch (error) {
      console.error('Error loading report:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Exporta ventas por período a CSV
   */
  const exportSalesCSV = () => {
    let csvContent = 'Período,Unidades Vendidas,Ingresos,Órdenes\n';
    salesData.forEach(row => {
      csvContent += `"${row.period}",${row.totalSales},${row.revenue.toFixed(2)},${row.orders}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ventas_${dateRange}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  /**
   * Exporta productos más vendidos a CSV
   */
  const exportProductsCSV = () => {
    let csvContent = 'Posición,Producto,Unidades Vendidas,Ingresos\n';
    topProducts.forEach((product, index) => {
      csvContent += `${index + 1},"${product.name}",${product.sold},${product.revenue.toFixed(2)}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `productos_mas_vendidos_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  /**
   * Renderiza gráfico de barras horizontal para productos
   */
  const renderProductsChart = () => {
    if (topProducts.length === 0) {
      return (
        <div className="text-center py-12">
          <BarChart3 size={48} className="mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">No hay datos de productos disponibles</p>
        </div>
      );
    }

    const maxSold = Math.max(...topProducts.map(p => p.sold));

    return (
      <div className="space-y-3">
        {topProducts.map((product, index) => {
          const percentage = (product.sold / maxSold) * 100;

          return (
            <div key={product.id} className="space-y-1">
              <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-600 w-6">#{index + 1}</span>
                  <span className="font-medium text-gray-900">{product.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-gray-700 font-semibold">{product.sold} unidades</span>
                  <span className="text-green-600 font-medium">${product.revenue.toFixed(2)}</span>
                </div>
              </div>
              <div className="relative h-8 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500"
                  style={{ width: `${percentage}%` }}
                >
                  <div className="h-full flex items-center justify-end pr-3">
                    {percentage > 15 && (
                      <span className="text-white text-xs font-semibold">
                        {percentage.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Reportes y Análisis</h2>
      </div>

      {/* Estadísticas Generales */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm font-medium">Ingresos Totales</p>
              <p className="text-3xl font-bold mt-2">${totalStats.totalRevenue.toFixed(2)}</p>
            </div>
            <DollarSign className="w-12 h-12 opacity-80" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm font-medium">Total Órdenes</p>
              <p className="text-3xl font-bold mt-2">{totalStats.totalOrders}</p>
            </div>
            <BarChart3 className="w-12 h-12 opacity-80" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm font-medium">Unidades Vendidas</p>
              <p className="text-3xl font-bold mt-2">{totalStats.totalUnits}</p>
            </div>
            <TrendingUp className="w-12 h-12 opacity-80" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm font-medium">Ticket Promedio</p>
              <p className="text-3xl font-bold mt-2">${totalStats.averageOrderValue.toFixed(2)}</p>
            </div>
            <DollarSign className="w-12 h-12 opacity-80" />
          </div>
        </div>
      </div>

      {/* Selector de Período */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Calendar className="text-gray-500" />
            <h3 className="text-lg font-semibold text-gray-900">Ventas por Período</h3>
          </div>
          <div className="flex gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRange)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="day">Por Día (últimos 30 días)</option>
              <option value="week">Por Semana (últimas 12 semanas)</option>
              <option value="month">Por Mes (últimos 12 meses)</option>
              <option value="year">Por Año (últimos 5 años)</option>
            </select>
            <button
              onClick={exportSalesCSV}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Download size={18} />
              Exportar CSV
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Cargando datos...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Período
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Unidades Vendidas
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ingresos
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Órdenes
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {salesData.map((row, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {row.period}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.totalSales}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-semibold">
                      ${row.revenue.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.orders}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {salesData.length === 0 && (
              <p className="text-center py-8 text-gray-500">No hay datos de ventas disponibles en este período</p>
            )}
          </div>
        )}
      </div>

      {/* Productos Más Vendidos */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <TrendingUp className="text-gray-500" />
            <h3 className="text-lg font-semibold text-gray-900">Productos Más Vendidos</h3>
          </div>
          <button
            onClick={exportProductsCSV}
            disabled={topProducts.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <Download size={18} />
            Exportar CSV
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Cargando datos...</p>
          </div>
        ) : (
          renderProductsChart()
        )}
      </div>
    </div>
  );
}
