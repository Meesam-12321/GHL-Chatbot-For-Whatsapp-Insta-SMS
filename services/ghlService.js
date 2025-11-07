const axios = require('axios');

class GHLService {
  constructor() {
    this.apiKey = process.env.GHL_API_KEY;
    this.baseUrl = 'https://services.leadconnectorhq.com';
    this.defaultLocationId = process.env.GHL_LOCATION_ID;
  }
  
  // Detect channel type from original message data
  detectChannelType(messageData) {
    // Check platform/source field
    const platform = messageData.platform || messageData.source || '';
    const messageType = messageData.message_type || '';
    
    // Priority: explicit platform > message type patterns > fallback
    if (platform.toLowerCase().includes('instagram') || platform === 'IG') {
      return 'IG';
    }
    if (platform.toLowerCase().includes('whatsapp') || platform === 'WA') {
      return 'WhatsApp';
    }
    if (platform.toLowerCase().includes('sms') || platform === 'SMS') {
      return 'SMS';
    }
    
    // Fallback logic based on phone format or message characteristics
    if (messageData.phone && messageData.phone.startsWith('+')) {
      return 'SMS'; // Most likely SMS if we have phone number
    }
    
    return 'SMS'; // Default fallback
  }
  
  // Send message back to contact
  async sendMessage(contactId, message, locationId = null, originalMessageData = {}) {
    try {
      const location = locationId || this.defaultLocationId;
      const channelType = this.detectChannelType(originalMessageData);
      
      const payload = {
        type: channelType,
        contactId: contactId,
        locationId: location,
        message: message
      };
      
      console.log('📤 Sending GHL message:', { 
        contactId, 
        channel: channelType,
        messageLength: message.length 
      });
      
      const response = await axios.post(
        `${this.baseUrl}/conversations/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Version': '2021-04-15',
            'User-Agent': 'GHL-Webhook-Bot/1.0'
          },
          timeout: 15000 // Increased timeout for reliability
        }
      );
      
      console.log('✅ Message sent successfully via', channelType);
      return response.data;
      
    } catch (error) {
      console.error('❌ Failed to send GHL message:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }
  
  // Update contact tags
  async updateContactTags(contactId, tags, locationId = null) {
    try {
      const location = locationId || this.defaultLocationId;
      
      // Convert tags array to the format GHL expects
      const tagArray = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
      
      console.log('🏷️ Updating contact tags:', { contactId, tags: tagArray });
      
      const response = await axios.post(
        `${this.baseUrl}/contacts/${contactId}/tags`,
        {
          tags: tagArray
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Version': '2021-04-15'
          },
          timeout: 10000
        }
      );
      
      console.log('✅ Tags updated successfully');
      return response.data;
      
    } catch (error) {
      console.error('❌ Failed to update tags:', error.response?.data || error.message);
      // Don't throw error for tags - it's not critical
      return null;
    }
  }
  
  // Get contact opportunities
  async getContactOpportunities(contactId, locationId = null) {
    try {
      const location = locationId || this.defaultLocationId;
      
      console.log('🔍 Fetching opportunities for contact:', contactId);
      
      const response = await axios.get(
        `${this.baseUrl}/pipelines/${location}/opportunities`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Version': '2021-04-15'
          },
          params: {
            contactId: contactId
          },
          timeout: 10000
        }
      );
      
      const opportunities = response.data.opportunities || [];
      console.log(`📊 Found ${opportunities.length} opportunities`);
      
      return opportunities;
      
    } catch (error) {
      console.error('❌ Failed to fetch opportunities:', error.response?.data || error.message);
      return [];
    }
  }
  
  // Create new opportunity
  async createOpportunity(contactId, title, locationId = null, source = 'WhatsApp Automation') {
    try {
      const location = locationId || this.defaultLocationId;
      
      const payload = {
        contactId: contactId,
        title: title,
        source: source,
        status: 'open',
        value: 0 // Will be updated when quote is provided
      };
      
      console.log('💼 Creating new opportunity:', { contactId, title });
      
      const response = await axios.post(
        `${this.baseUrl}/pipelines/${location}/opportunities`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Version': '2021-04-15'
          },
          timeout: 10000
        }
      );
      
      console.log('✅ Opportunity created:', response.data.id);
      return response.data;
      
    } catch (error) {
      console.error('❌ Failed to create opportunity:', error.response?.data || error.message);
      return null;
    }
  }
  
  // Update existing opportunity
  async updateOpportunity(opportunityId, updates, locationId = null) {
    try {
      const location = locationId || this.defaultLocationId;
      
      console.log('🔄 Updating opportunity:', { opportunityId, updates });
      
      const response = await axios.put(
        `${this.baseUrl}/pipelines/${location}/opportunities/${opportunityId}`,
        updates,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Version': '2021-04-15'
          },
          timeout: 10000
        }
      );
      
      console.log('✅ Opportunity updated successfully');
      return response.data;
      
    } catch (error) {
      console.error('❌ Failed to update opportunity:', error.response?.data || error.message);
      return null;
    }
  }
  
  // Check if it's business hours (9 AM - 6 PM, Mon-Sat, France timezone)
  isBusinessHours() {
    const now = new Date();
    const franceTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Paris"}));
    
    const hour = franceTime.getHours();
    const day = franceTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    const isWeekday = day >= 1 && day <= 6; // Monday to Saturday
    const isBusinessHour = hour >= 9 && hour < 18; // 9 AM to 6 PM
    
    return isWeekday && isBusinessHour;
  }
  
  // Send after-hours response
  async sendAfterHoursResponse(contactId, locationId = null) {
    const message = "Merci pour votre message! 🕘 Nous sommes actuellement fermés (9h-18h, Lun-Sam). Nous vous répondrons dès l'ouverture. Pour une urgence, consultez reparaloya.com.uy";
    return this.sendMessage(contactId, message, locationId);
  }
}

module.exports = new GHLService();
