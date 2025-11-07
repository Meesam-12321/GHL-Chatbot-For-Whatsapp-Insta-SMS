const fs = require('fs');
const path = require('path');

class PricingService {
  constructor() {
    this.pricingData = null;
    this.lastFetch = null;
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
    this.csvFilePath = path.join(__dirname, '..', 'pricing.csv');
  }
  
  async getPricingData() {
    try {
      // Check cache first
      if (this.pricingData && this.lastFetch && 
          (Date.now() - this.lastFetch) < this.cacheTimeout) {
        console.log('📊 Using cached pricing data');
        return this.pricingData;
      }
      
      console.log('📊 Reading pricing data from local CSV file...');
      console.log('📁 CSV file path:', this.csvFilePath);
      
      // Check if file exists
      if (!fs.existsSync(this.csvFilePath)) {
        throw new Error(`Pricing CSV file not found at: ${this.csvFilePath}. Please ensure pricing.csv is in the project root.`);
      }
      
      // Read the CSV file
      const csvData = fs.readFileSync(this.csvFilePath, 'utf8');
      
      if (!csvData.trim()) {
        throw new Error('CSV file is empty');
      }
      
      // Parse CSV data
      const lines = csvData.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        throw new Error('Invalid CSV data - no pricing rows found');
      }
      
      // Parse headers
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      console.log('📋 CSV Headers:', headers);
      
      // Parse data rows
      const pricingItems = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        
        if (values.length >= 2 && values[0]) { // Must have product name and price
          const item = {};
          headers.forEach((header, index) => {
            item[header] = values[index] || '';
          });
          pricingItems.push(item);
        }
      }
      
      this.pricingData = {
        items: pricingItems,
        total_count: pricingItems.length,
        last_updated: new Date().toISOString(),
        headers: headers,
        source: 'local-csv'
      };
      
      this.lastFetch = Date.now();
      
      console.log(`✅ Loaded ${pricingItems.length} pricing items from local CSV`);
      console.log('📋 Sample items:', pricingItems.slice(0, 3).map(item => 
        `${item[headers[0]]} - ${item[headers[1]] || 'N/A'}`
      ));
      
      return this.pricingData;
      
    } catch (error) {
      console.error('❌ Error reading pricing CSV:', error.message);
      
      // Return cached data if available, even if expired
      if (this.pricingData) {
        console.log('⚠️ Returning expired cached data due to file read error');
        return this.pricingData;
      }
      
      // Return empty data as fallback
      return {
        items: [],
        total_count: 0,
        last_updated: new Date().toISOString(),
        error: `Failed to read pricing CSV: ${error.message}`,
        headers: [],
        source: 'local-csv-error'
      };
    }
  }
  
  // Helper method to search pricing data
  findPricing(device, service) {
    if (!this.pricingData || !this.pricingData.items) {
      return null;
    }
    
    const deviceLower = device.toLowerCase();
    const serviceLower = service.toLowerCase();
    
    return this.pricingData.items.find(item => {
      // Use the first column (Prod) as the searchable product field
      const itemProduct = (item[this.pricingData.headers[0]] || '').toLowerCase();
      
      // Check if device and service are mentioned in the product name
      return itemProduct.includes(deviceLower) && 
             (serviceLower === '' || itemProduct.includes(serviceLower));
    });
  }
  
  // Clear cache (useful for testing)
  clearCache() {
    this.pricingData = null;
    this.lastFetch = null;
    console.log('🗑️ Pricing cache cleared');
  }
}

module.exports = new PricingService();