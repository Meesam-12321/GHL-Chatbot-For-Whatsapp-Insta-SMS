const axios = require('axios');

class SimplifiedTagService {
  constructor() {
    this.apiKey = process.env.GHL_API_KEY;
    this.baseUrl = 'https://services.leadconnectorhq.com';
    
    // ONLY brand tags (as client requested)
    this.brandTags = {
      'iphone': 'iPhone',
      'apple': 'iPhone', 
      'samsung': 'Samsung',
      'galaxy': 'Samsung',
      'huawei': 'Huawei',
      'xiaomi': 'Xiaomi',
      'redmi': 'Xiaomi',
      'mi': 'Xiaomi',
      'motorola': 'Motorola',
      'moto': 'Motorola',
      'nokia': 'Nokia',
      'lg': 'LG',
      'sony': 'Sony',
      'google': 'Google',
      'pixel': 'Google',
      'honor': 'Honor',
      'oppo': 'Oppo',
      'vivo': 'Vivo',
      'realme': 'Realme',
      'oneplus': 'OnePlus',
      'asus': 'Asus',
      'caterpillar': 'Caterpillar',
      'cat': 'Caterpillar',
      'lenovo': 'Lenovo',
      'tcl': 'TCL',
      'tecno': 'Tecno',
      'wiko': 'Wiko',
      'zte': 'ZTE'
    };
    
    // ONLY service/repair type tags (as client requested)
    this.serviceTags = {
      'pantalla': 'Pantalla',
      'display': 'Pantalla',
      'screen': 'Pantalla',
      'lcd': 'Pantalla',
      'oled': 'Pantalla',
      'tactil': 'Pantalla',
      'táctil': 'Pantalla',
      'touch': 'Pantalla',
      
      'bateria': 'Batería',
      'batería': 'Batería',
      'battery': 'Batería',
      
      'camara': 'Cámara',
      'cámara': 'Cámara',
      'camera': 'Cámara',
      'lente': 'Cámara',
      
      'carga': 'Carga',
      'charging': 'Carga',
      'conector': 'Carga',
      'puerto': 'Carga',
      'usb': 'Carga',
      'lightning': 'Carga',
      'tipo-c': 'Carga',
      'type-c': 'Carga',
      
      'altavoz': 'Altavoz',
      'speaker': 'Altavoz',
      'audio': 'Altavoz',
      'sonido': 'Altavoz',
      
      'vidrio': 'Vidrio',
      'glass': 'Vidrio',
      'cristal': 'Vidrio',
      'tapa': 'Vidrio',
      'cover': 'Vidrio',
      'back': 'Vidrio',
      'trasera': 'Vidrio',
      
      'flex': 'Flex',
      'flexible': 'Flex',
      'cable': 'Flex',
      
      'agua': 'Agua',
      'water': 'Agua',
      'mojado': 'Agua',
      'humedad': 'Agua'
    };
    
    console.log('🏷️ Simplified Tag Service initialized (Brand + Repair Type ONLY)');
  }
  
  /**
   * Generate ONLY brand and repair type tags (as client requested)
   * @param {Object} classification - AI classification result
   * @returns {Array} Array of tag names to add (ONLY brand + service)
   */
  generateTagsFromClassification(classification) {
    try {
      const tags = []; // Simple array, no duplicates needed
      
      console.log('🔄 Generating simplified tags from classification:', classification);
      
      // Add brand tag (if found)
      const brandTag = this._getBrandTag(classification);
      if (brandTag) {
        tags.push(brandTag);
        console.log(`📱 Added brand tag: ${brandTag}`);
      }
      
      // Add service/repair type tag (if found)
      const serviceTag = this._getServiceTag(classification);
      if (serviceTag) {
        tags.push(serviceTag);
        console.log(`🔧 Added service tag: ${serviceTag}`);
      }
      
      console.log(`✅ Generated ${tags.length} simplified tags:`, tags);
      
      return tags;
      
    } catch (error) {
      console.error('❌ Error generating simplified tags:', error.message);
      return []; // Return empty array if error
    }
  }
  
  /**
   * Add tags to contact with retry logic
   * @param {string} contactId - GHL contact ID
   * @param {Array} tags - Array of tag names
   * @param {string} locationId - GHL location ID
   * @returns {Promise<Object>} Result object
   */
  async addTags(contactId, tags, locationId = null) {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        if (!contactId || !tags || tags.length === 0) {
          console.log('⚠️ Invalid parameters for adding tags');
          return { success: false, error: 'Invalid parameters' };
        }
        
        const location = locationId || process.env.GHL_LOCATION_ID || 'hij5g6beL7ebCFVa1fyq';
        
        console.log(`🏷️ Adding ${tags.length} simplified tags to contact ${contactId} (attempt ${attempt + 1}/${maxRetries})`);
        console.log('📋 Tags to add:', tags);
        
        const response = await axios.post(
          `${this.baseUrl}/contacts/${contactId}/tags`,
          { tags: tags },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              'Version': '2021-04-15'
            },
            timeout: 15000
          }
        );
        
        console.log('✅ Simplified tags added successfully');
        
        return {
          success: true,
          data: response.data,
          tags_added: tags,
          attempt: attempt + 1
        };
        
      } catch (error) {
        attempt++;
        
        const errorMsg = error.response?.data?.message || error.message;
        console.error(`❌ Simplified tag addition attempt ${attempt} failed:`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          error: errorMsg
        });
        
        if (attempt >= maxRetries) {
          return {
            success: false,
            error: `All ${maxRetries} attempts failed. Last error: ${errorMsg}`,
            final_attempt: true
          };
        }
        
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }
  
  /**
   * Smart tag update - only add new tags, don't duplicate
   * @param {string} contactId - GHL contact ID
   * @param {Array} newTags - Tags to add
   * @param {string} locationId - GHL location ID
   * @returns {Promise<Object>} Result object
   */
  async updateTagsSmart(contactId, newTags, locationId = null) {
    try {
      if (newTags.length === 0) {
        console.log('✅ No tags to add');
        return {
          success: true,
          message: 'No tags to add',
          existing_tags: 0,
          new_tags: 0
        };
      }
      
      // Add tags (GHL handles duplicates automatically)
      const result = await this.addTags(contactId, newTags, locationId);
      
      return {
        ...result,
        new_tags: newTags.length
      };
      
    } catch (error) {
      console.error('❌ Smart tag update failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get brand tag from classification
   * @private
   */
  _getBrandTag(classification) {
    const brand = (classification.device_brand || 
                  classification.marca_dispositivo || 
                  classification.marque_appareil || 
                  '').toLowerCase();
    
    return this.brandTags[brand] || null;
  }
  
  /**
   * Get service tag from classification
   * @private
   */
  _getServiceTag(classification) {
    const service = (classification.service_type || 
                    classification.tipo_servicio || 
                    classification.type_service || 
                    '').toLowerCase();
    
    return this.serviceTags[service] || null;
  }
  
  /**
   * Get service health status
   */
  getHealthStatus() {
    return {
      service: 'SimplifiedTagService',
      status: 'ready',
      version: '1.0.0-simplified',
      features: {
        brand_tags: Object.keys(this.brandTags).length,
        service_tags: Object.keys(this.serviceTags).length,
        extra_tags: 0, // No extra tags in simplified version
        smart_update: true,
        retry_logic: true
      },
      api_endpoint: this.baseUrl,
      has_api_key: !!this.apiKey,
      note: 'Simplified version - ONLY brand and repair type tags as requested'
    };
  }
  
  /**
   * Get available tag categories (simplified)
   */
  getAvailableTagCategories() {
    return {
      brands: Object.values(this.brandTags),
      services: Object.values(this.serviceTags),
      note: 'Only brand and service tags - no extra system tags'
    };
  }
}

module.exports = new SimplifiedTagService();