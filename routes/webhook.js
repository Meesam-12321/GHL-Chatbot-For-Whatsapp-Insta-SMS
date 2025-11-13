const express = require('express');
const router = express.Router();
const SimplifiedAIService = require('../services/aiService');
const SimplifiedPricingService = require('../services/pricingService');
const axios = require('axios');

// POST /webhook/ghl - Simplified GHL webhook
router.post('/ghl', async (req, res) => {
  try {
    console.log('📨 GHL webhook received');
    
    if (!req.body) {
      return res.status(400).json({ error: 'No data received' });
    }
    
    // Extract message data
    const messageData = extractMessageData(req.body);
    
    console.log('📋 Message data:', {
      contact_id: messageData.contact_id,
      contact_name: messageData.contact_name,
      message_type: messageData.message_type,
      has_content: !!messageData.content,
      has_media: !!messageData.media_url
    });

    // Quick response to GHL
    res.status(200).json({ 
      status: 'received', 
      message: 'Processing your request...',
      contact_id: messageData.contact_id,
      timestamp: new Date().toISOString()
    });
    
    // Process message asynchronously
    processMessageAsync(messageData);
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: 'Internal error', details: error.message });
  }
});

function extractMessageData(body) {
  const contact = body.contact || {};
  const message = body.message || {};
  
  const messageData = {
    contact_id: body.customData?.contact_id || contact.id || body.contactId,
    contact_name: body.customData?.contact_name || contact.name || contact.firstName || 'Cliente',
    contact_phone: contact.phone || '',
    location_id: body.location?.id || 'hij5g6beL7ebCFVa1fyq',
    channel: body.customData?.channel || 
             body.contact?.attributionSource?.medium || 
             'SMS',
    message_id: message.id,
    conversation_id: body.conversation?.id || '',
  };
  
  // Parse message content
  const content = body.customData?.message_text || message.body || message.text || '';
  const mediaUrl = body.customData?.debug_has_attachments || body.customData?.media_url || '';
  
  // Determine message type
  let messageType = 'text';
  if (mediaUrl) {
    if (mediaUrl.includes('.jpg') || mediaUrl.includes('.jpeg') || 
        mediaUrl.includes('.png') || mediaUrl.includes('.gif')) {
      messageType = 'image';
    } else {
      messageType = 'voice'; // All other media as voice
    }
  }
  
  // Check for attachments
  const attachments = message.attachments || [];
  if (attachments.length > 0) {
    const attachment = attachments[0];
    messageType = attachment.type === 'image' ? 'image' : 'voice';
    messageData.media_url = attachment.url;
  } else {
    messageData.media_url = mediaUrl;
  }
  
  messageData.message_type = messageType;
  messageData.content = content;
  
  console.log(`✅ Detected: ${messageType.toUpperCase()} message`);
  
  return messageData;
}

async function processMessageAsync(messageData) {
  try {
    console.log('🔄 Processing message...');
    
    // Validate data
    if (!messageData.content && !messageData.media_url) {
      console.log('⚠️ No content or media, skipping');
      return;
    }
    
    if (!messageData.contact_id) {
      console.log('⚠️ No contact_id, cannot send response');
      return;
    }
    
    // Process with AI
    console.log('🤖 Generating AI response...');
    const aiResult = await SimplifiedAIService.processMessage(
      messageData.content,
      messageData.message_type,
      messageData.media_url,
      null, // pricingData not needed - AI service handles search
      {
        contact_id: messageData.contact_id,
        full_name: messageData.contact_name,
        phone: messageData.contact_phone,
        channel: messageData.channel
      }
    );
    
    console.log('✅ AI response generated:', {
      response_length: aiResult.customer_response?.length,
      language: aiResult.classification?.language,
      products_found: aiResult.pricing_items_found
    });
    
    // Send response
    if (aiResult.customer_response && aiResult.customer_response.trim()) {
      console.log('📤 Sending response...');
      await sendResponse(messageData, aiResult.customer_response);
      console.log('✅ Response sent successfully');
      
      // Optional: Add tags (non-blocking)
      try {
        await addTags(messageData.contact_id, aiResult.classification, messageData.location_id);
      } catch (tagError) {
        console.log('⚠️ Tagging failed (non-critical):', tagError.message);
      }
      
    } else {
      console.log('⚠️ No AI response generated');
    }
    
  } catch (error) {
    console.error('❌ Message processing error:', error.message);
  }
}

async function sendResponse(messageData, responseText) {
  try {
    // Determine message type based on channel
    const channel = messageData.channel?.toLowerCase() || '';
    let messageType = "SMS"; // Default
    
    if (channel.includes('instagram')) {
      messageType = "IG";
    } else if (channel.includes('facebook') || channel.includes('messenger')) {
      messageType = "FB";
    } else if (channel.includes('whatsapp')) {
      messageType = "WhatsApp";
    }

    console.log('📤 Sending message via', messageType);

    const payload = {
      type: messageType,
      contactId: messageData.contact_id,
      locationId: messageData.location_id,
      message: responseText
    };

    const response = await axios.post(
      'https://services.leadconnectorhq.com/conversations/messages', 
      payload,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
          'Version': '2021-04-15'
        },
        timeout: 30000
      }
    );
    
    console.log('✅ Message sent successfully');
    return response.data;
    
  } catch (error) {
    console.error('❌ Failed to send message:', error.response?.data || error.message);
    throw error;
  }
}

async function addTags(contactId, classification, locationId) {
  try {
    const tags = [];
    
    // Add brand tag
    if (classification.device_brand !== 'unknown') {
      tags.push(classification.device_brand);
    }
    
    // Add service tag
    if (classification.service_type !== 'consulta general') {
      tags.push(`Reparación ${classification.service_type}`);
    }
    
    if (tags.length === 0) return;
    
    console.log('🏷️ Adding tags:', tags);
    
    // Add tags via GHL API
    await axios.post(
      'https://services.leadconnectorhq.com/contacts/' + contactId + '/tags',
      { tags },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
          'Version': '2021-04-15'
        },
        timeout: 10000
      }
    );
    
    console.log('✅ Tags added successfully');
    
  } catch (error) {
    console.error('❌ Tagging error:', error.message);
    throw error;
  }
}

// Test endpoint
router.post('/test', async (req, res) => {
  console.log('🧪 Test webhook received:', req.body);
  
  const testMessage = req.body.message || "Hola, mi iPhone 13 Pro necesita cambio de pantalla. ¿Cuánto cuesta?";
  
  const mockPayload = {
    contact: {
      id: "test_contact_123",
      name: "Test User",
      phone: "+1234567890"
    },
    message: {
      id: "test_msg_123",
      body: testMessage,
      attachments: []
    },
    locationId: "hij5g6beL7ebCFVa1fyq"
  };
  
  const messageData = extractMessageData(mockPayload);
  processMessageAsync(messageData);
  
  res.json({ 
    status: 'Test message processing started',
    message_data: messageData
  });
});

// Health check
router.get('/health', async (req, res) => {
  try {
    // Test pricing service
    await FixedPricingService.getPricingData();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: 'semantic-search-1.0',
      services: {
        simplified_ai: 'ready',
        fixed_pricing_semantic: 'ready'
      },
      environment: {
        has_ghl_key: !!process.env.GHL_API_KEY,
        has_openai_key: !!process.env.OPENAI_API_KEY
      },
      features: {
        semantic_search: 'enabled',
        exact_model_matching: 'enabled',
        approximate_matching: 'enabled'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Search endpoint for testing
router.post('/search', async (req, res) => {
  try {
    const query = req.body.query || req.query.q || 'iPhone 13 pantalla';
    
    console.log(`🔍 Testing semantic search for: "${query}"`);
    
    const products = await FixedPricingService.searchProducts(query, 10);
    
    res.json({
      success: true,
      query: query,
      products_found: products.length,
      search_type: 'semantic',
      products: products.map(p => ({
        name: p.Prod || Object.values(p)[0],
        price: p['PUBLICO TIENDA'] || 'N/A',
        similarity: p._similarity ? (p._similarity * 100).toFixed(1) + '%' : undefined,
        score: p._score || undefined,
        is_approximate: p._isApproximate || false,
        exact_model_requested: p._exactModelRequested || undefined
      })),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

module.exports = router;