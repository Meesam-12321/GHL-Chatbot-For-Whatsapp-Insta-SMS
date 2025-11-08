const axios = require('axios');

class TagService {
  constructor() {
    this.apiKey = process.env.GHL_API_KEY;
    this.baseUrl = 'https://services.leadconnectorhq.com';
    this.apiVersion = '2021-07-28';
  }

  /**
   * Add tags to contact without overwriting existing ones
   * @param {string} contactId - GHL contact ID
   * @param {string[]} newTags - Array of new tags to add
   * @returns {Promise<Object|null>} - API response or null if failed
   */
  async addTags(contactId, newTags) {
    try {
      if (!contactId) {
        console.log('⚠️ TagService: No contact ID provided');
        return null;
      }

      if (!newTags || newTags.length === 0) {
        console.log('📋 TagService: No tags to add');
        return null;
      }

      // Filter out empty/invalid tags
      const validTags = newTags.filter(tag => tag && tag.trim());
      if (validTags.length === 0) {
        console.log('📋 TagService: No valid tags after filtering');
        return null;
      }

      console.log(`🏷️ TagService: Adding tags [${validTags.join(', ')}] to contact ${contactId}`);
      
      // Step 1: Get current contact tags
      const currentTags = await this._getCurrentTags(contactId);
      if (currentTags === null) {
        console.error('❌ TagService: Failed to get current tags, aborting tag update');
        return null;
      }

      // Step 2: Merge tags (remove duplicates)
      const uniqueTags = [...new Set([...currentTags, ...validTags])];
      console.log('📋 TagService: Final tag list:', uniqueTags);

      // Step 3: Update contact
      const result = await this._updateContactTags(contactId, uniqueTags);
      
      if (result) {
        console.log('✅ TagService: Tags updated successfully');
        return result;
      } else {
        console.error('❌ TagService: Failed to update tags');
        return null;
      }

    } catch (error) {
      console.error('❌ TagService: Unexpected error in addTags:', error.message);
      return null;
    }
  }

  /**
   * Generate tags from AI classification
   * @param {Object} classification - AI classification result
   * @returns {string[]} - Array of generated tags
   */
  generateTagsFromClassification(classification) {
    try {
      const tags = [];
      
      // Add device brand tag
      if (classification.device_brand && classification.device_brand !== 'unknown') {
        tags.push(classification.device_brand);
      }
      
      // Add service type tag with Spanish translations
      if (classification.service_type && classification.service_type !== 'general inquiry') {
        const serviceTypeMap = {
          'screen': 'Pantalla',
          'battery': 'Batería', 
          'charging': 'Carga',
          'camera': 'Cámara',
          'speaker': 'Altavoz',
          'water_damage': 'Daño por agua'
        };
        
        const spanishService = serviceTypeMap[classification.service_type] || classification.service_type;
        tags.push(spanishService);
      }
      
      // Add urgency tag for high priority
      if (classification.urgency === 'high') {
        tags.push('Urgente');
      }
      
      // Add source tag
      tags.push('ChatBot AI');
      
      // Add language tag
      if (classification.language) {
        const langMap = {
          'en': 'English',
          'es': 'Español', 
          'fr': 'Français'
        };
        const languageTag = langMap[classification.language] || classification.language;
        tags.push(languageTag);
      }
      
      const finalTags = tags.filter(tag => tag && tag.trim());
      console.log('🏷️ TagService: Generated tags:', finalTags);
      return finalTags;

    } catch (error) {
      console.error('❌ TagService: Error generating tags:', error.message);
      return [];
    }
  }

  /**
   * Get current tags for a contact
   * @private
   * @param {string} contactId - GHL contact ID
   * @returns {Promise<string[]|null>} - Array of current tags or null if failed
   */
  async _getCurrentTags(contactId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/contacts/${contactId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Version': this.apiVersion
          },
          timeout: 10000
        }
      );

      const currentTags = response.data.contact.tags || [];
      console.log('📋 TagService: Current tags:', currentTags);
      return currentTags;

    } catch (error) {
      console.error('❌ TagService: Failed to get current tags:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Update contact tags
   * @private
   * @param {string} contactId - GHL contact ID
   * @param {string[]} tags - Array of all tags
   * @returns {Promise<Object|null>} - API response or null if failed
   */
  async _updateContactTags(contactId, tags) {
    try {
      const response = await axios.put(
        `${this.baseUrl}/contacts/${contactId}`,
        { tags: tags },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Version': this.apiVersion
          },
          timeout: 10000
        }
      );

      return response.data;

    } catch (error) {
      console.error('❌ TagService: Failed to update contact tags:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Health check for TagService
   * @returns {Object} - Service health status
   */
  getHealthStatus() {
    return {
      service: 'TagService',
      status: this.apiKey ? 'ready' : 'missing_api_key',
      hasApiKey: !!this.apiKey,
      baseUrl: this.baseUrl,
      version: '1.0.0'
    };
  }
}

module.exports = new TagService();