const pricingService = require('./services/pricingService');
const aiService = require('./services/aiService');
const ghlService = require('./services/ghlService');

class MessageProcessor {
  async processMessage(messageData) {
    try {
      console.log('\n🔄 Processing message for contact:', messageData.contact_id);
      console.log('📱 Message type:', messageData.message_type);
      console.log('💬 Content preview:', messageData.message?.substring(0, 100));
      
      // Step 1: Get fresh pricing data
      console.log('📊 Fetching pricing data...');
      const pricingData = await pricingService.getPricingData();
      
      if (!pricingData || pricingData.items.length === 0) {
        throw new Error('No pricing data available');
      }
      
      // Step 2: Process with AI (handles voice, image, text)
      console.log('🤖 Processing with AI...');
      const aiResult = await aiService.processMessage(
        messageData.message,
        messageData.message_type,
        messageData.media_url,
        pricingData,
        {
          contact_id: messageData.contact_id,
          full_name: messageData.full_name,
          phone: messageData.phone
        }
      );
      
      // Step 3: Send response to customer
      console.log('📤 Sending customer response...');
      await ghlService.sendMessage(
        messageData.contact_id,
        aiResult.customer_response,
        messageData.location_id,
        messageData // Pass original data for channel detection
      );
      
      // Step 4: Update contact tags (non-blocking)
      this.updateContactTagsAsync(messageData, aiResult.classification);
      
      // Step 5: Handle opportunities (non-blocking)
      this.manageOpportunityAsync(messageData, aiResult.classification);
      
      console.log('✅ Message processing completed successfully');
      
      return {
        status: 'success',
        customer_response: aiResult.customer_response,
        classification: aiResult.classification,
        processed_content: aiResult.processed_content
      };
      
    } catch (error) {
      console.error('❌ Message processing failed:', error.message);
      
      // Send fallback response
      try {
        const fallbackMessage = "Merci pour votre message! Nous traitons votre demande et vous répondrons bientôt. Pour plus d'informations, visitez reparaloya.com.uy";
        await ghlService.sendMessage(
          messageData.contact_id,
          fallbackMessage,
          messageData.location_id,
          messageData // Pass original data for channel detection
        );
        console.log('📤 Fallback response sent');
      } catch (fallbackError) {
        console.error('❌ Failed to send fallback response:', fallbackError.message);
      }
      
      return {
        status: 'error',
        error: error.message,
        fallback_sent: true
      };
    }
  }
  
  // Update contact tags in background
  async updateContactTagsAsync(messageData, classification) {
    try {
      // Extract classification data (handle different language fields)
      const deviceBrand = classification.device_brand || 
                         classification.marque_appareil || 
                         classification.marca_dispositivo || 'unknown';
      
      const serviceType = classification.service_type || 
                         classification.type_service || 
                         classification.tipo_servicio || 'unknown';
      
      const urgency = classification.urgency || 
                     classification.urgence || 
                     classification.urgencia || 'medium';
      
      const tags = [deviceBrand, serviceType, urgency, 'auto-tagged'];
      
      await ghlService.updateContactTags(
        messageData.contact_id,
        tags,
        messageData.location_id
      );
      
    } catch (error) {
      console.error('⚠️ Failed to update tags (non-critical):', error.message);
    }
  }
  
  // Manage opportunities in background
  async manageOpportunityAsync(messageData, classification) {
    try {
      // Get existing opportunities
      const opportunities = await ghlService.getContactOpportunities(
        messageData.contact_id,
        messageData.location_id
      );
      
      // Extract device info for opportunity title
      const deviceBrand = classification.device_brand || 
                         classification.marque_appareil || 
                         classification.marca_dispositivo || 'Appareil';
      
      const deviceModel = classification.device_model || 
                         classification.modele_appareil || 
                         classification.modelo_dispositivo || '';
      
      const opportunityTitle = `Réparation ${deviceBrand} ${deviceModel}`.trim();
      
      if (opportunities && opportunities.length > 0) {
        // Update existing opportunity
        console.log('🔄 Updating existing opportunity');
        await ghlService.updateOpportunity(
          opportunities[0].id,
          {
            name: opportunityTitle,
            source: 'WhatsApp Automation',
            status: 'open'
          },
          messageData.location_id
        );
      } else {
        // Create new opportunity
        console.log('💼 Creating new opportunity');
        await ghlService.createOpportunity(
          messageData.contact_id,
          opportunityTitle,
          messageData.location_id
        );
      }
      
    } catch (error) {
      console.error('⚠️ Failed to manage opportunity (non-critical):', error.message);
    }
  }
}

module.exports = new MessageProcessor();