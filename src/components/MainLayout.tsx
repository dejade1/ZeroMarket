import React, { useState, useEffect } from 'react';
import { Navbar } from './Navbar';
import { CategoryBar } from './CategoryBar';
import { ProductCard } from './ProductCard';
import { Cart } from './Cart';
import { getAllProducts } from '../lib/inventory';
import type { Product } from '../lib/inventory';

export function MainLayout() {
  const [searchTerm, setSearchTerm] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);

  // Cargar productos
  useEffect(() => {
    const loadProducts = async () => {
      const productData = await getAllProducts();
      setProducts(productData);
      setFilteredProducts(productData);
    };
    loadProducts();
  }, []);

  const handleSearch = (term: string) => {
    setSearchTerm(term);
    const filtered = products.filter(product =>
      product.title.toLowerCase().includes(term.toLowerCase())
    );
    setFilteredProducts(filtered);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar onSearch={handleSearch} searchTerm={searchTerm} />
      <CategoryBar />
      <Cart />

      <main className="max-w-7xl mx-auto px-4 py-8">
        {searchTerm ? (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Resultados de búsqueda para "{searchTerm}"
            </h2>
            {filteredProducts.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredProducts.map((product) => (
                  <ProductCard key={product.id} {...product} />
                ))}
              </div>
            ) : (
              <p className="text-gray-600">No se encontraron productos que coincidan con tu búsqueda.</p>
            )}
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Productos Básicos</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.map((product) => (
                  <ProductCard key={product.id} {...product} />
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}