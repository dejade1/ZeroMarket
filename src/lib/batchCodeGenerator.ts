/**
 * Generador de código de lote
 * Formato: [Prefijo]-[NumLote]-[FechaIngreso]
 * Ejemplo: AcdeOlVi-1-10122025
 */

/**
 * Genera prefijo del producto basado en sus palabras
 * "Aceite de Oliva Virgen" → "AcdeOlVi"
 */
export function generateBatchPrefix(productName: string): string {
  const words = productName
    .split(/\s+/)
    .filter(word => word.length > 0)
    .slice(0, 4); // Máximo 4 palabras

  if (words.length === 0) return 'PRD';

  return words
    .map(word => word.substring(0, 2).toLowerCase())
    .join('');
}

/**
 * Obtiene el número de lote siguiente para un producto
 */
export function getNextBatchNumber(existingBatches: any[]): number {
  if (existingBatches.length === 0) return 1;

  const batchNumbers = existingBatches
    .map(batch => {
      // Extraer número del formato: "Prefix-NUMBER-DATE"
      const match = batch.batchCode?.match(/-(‍\d+)-/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(num => num > 0);

  return batchNumbers.length > 0 ? Math.max(...batchNumbers) + 1 : 1;
}

/**
 * Formatea fecha a DDMMAAAA
 */
export function formatDateToDDMMYYYY(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}${month}${year}`;
}

/**
 * Genera código de lote completo
 */
export function generateBatchCode(
  productName: string,
  existingBatches: any[],
  entryDate: Date = new Date()
): string {
  const prefix = generateBatchPrefix(productName);
  const batchNumber = getNextBatchNumber(existingBatches);
  const formattedDate = formatDateToDDMMYYYY(entryDate);

  return `${prefix}-${batchNumber}-${formattedDate}`;
}

/**
 * Valida que la fecha de caducidad sea mayor a la fecha actual
 */
export function isValidExpiryDate(expiryDate: Date | string): boolean {
  const expiry = typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);

  return expiry > today;
}

/**
 * Formatea fecha de caducidad para mostrar (DD/MM/YYYY)
 */
export function formatExpiryDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Verifica si una fecha está próxima a caducar (menos de 30 días)
 */
export function isExpiryDateSoon(date: Date | string): boolean {
  const expiry = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();
  const daysUntilExpiry = (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry <= 30 && daysUntilExpiry > 0;
}
