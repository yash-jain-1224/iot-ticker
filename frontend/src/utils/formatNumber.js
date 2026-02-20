/**
 * Format numbers progressively: 1, 1K, 1M, 1B
 * Values start from 1, then format as thousands (K), millions (M), billions (B)
 * 
 * @param {number} value - The number to format
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted number string
 */
export function formatNumber(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }

  const num = Number(value);

  // For values less than 1000, show as-is with no decimals
  if (Math.abs(num) < 1000) {
    return num.toFixed(0);
  }

  // For thousands (1K - 999K)
  if (Math.abs(num) < 1000000) {
    return (num / 1000).toFixed(decimals) + 'K';
  }

  // For millions (1M - 999M)
  if (Math.abs(num) < 1000000000) {
    return (num / 1000000).toFixed(decimals) + 'M';
  }

  // For billions (1B+)
  return (num / 1000000000).toFixed(decimals) + 'B';
}

/**
 * Format KPI value with unit
 * 
 * @param {number} value - The KPI value
 * @param {string} type - The KPI type ('oee', 'production', 'downtime', 'energy')
 * @returns {object} Object with formatted value and unit
 */
export function formatKPIValue(value, type) {
  if (value === null || value === undefined || isNaN(value)) {
    return { value: 'N/A', unit: '' };
  }

  const num = Number(value);

  switch (type) {
    case 'oee':
      // OEE is a percentage, show with 1 decimal
      return {
        value: num.toFixed(1),
        unit: '%'
      };

    case 'production':
      // Production units - use progressive formatting
      return {
        value: formatNumber(num, 1),
        unit: 'units'
      };

    case 'downtime':
      // Downtime in minutes - no progressive formatting needed
      return {
        value: num.toFixed(0),
        unit: 'min'
      };

    case 'energy':
      // Energy - use progressive formatting
      return {
        value: formatNumber(num, 1),
        unit: 'kWh'
      };

    default:
      return {
        value: formatNumber(num, 1),
        unit: ''
      };
  }
}
