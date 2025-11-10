const fs = require('fs');
const path = require('path');

class ConversationMemoryService {
  constructor() {
    this.memoryDir = path.join(__dirname, '..', 'conversation-memory');
    this.maxMessagesPerConversation = 50; // Keep last 50 messages
    this.maxConversationAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    
    // Ensure memory directory exists
    this._ensureMemoryDirectory();
    
    console.log('🧠 Conversation Memory Service initialized');
  }
  
  /**
   * Store a message in conversation history
   * @param {string} contactId - GHL contact ID
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content - Message content
   * @param {Object} metadata - Additional metadata (message_type, media_url, etc.)
   */
  async storeMessage(contactId, role, content, metadata = {}) {
    try {
      if (!contactId || !role || !content) {
        console.log('⚠️ Invalid parameters for storing message');
        return false;
      }
      
      const conversationFile = this._getConversationFile(contactId);
      let conversation = this._loadConversation(contactId);
      
      const message = {
        timestamp: new Date().toISOString(),
        role: role, // 'user' or 'assistant'
        content: content.substring(0, 2000), // Limit content length
        metadata: {
          message_id: metadata.message_id || this._generateMessageId(),
          message_type: metadata.message_type || 'text',
          media_url: metadata.media_url || '',
          channel: metadata.channel || 'SMS',
          contact_name: metadata.contact_name || '',
          ...metadata
        }
      };
      
      conversation.messages.push(message);
      conversation.last_updated = new Date().toISOString();
      conversation.message_count = conversation.messages.length;
      
      // Keep only the last N messages to prevent memory bloat
      if (conversation.messages.length > this.maxMessagesPerConversation) {
        conversation.messages = conversation.messages.slice(-this.maxMessagesPerConversation);
      }
      
      // Save to file
      fs.writeFileSync(conversationFile, JSON.stringify(conversation, null, 2));
      
      console.log(`💾 Stored ${role} message for contact ${contactId} (${conversation.messages.length} total messages)`);
      return true;
      
    } catch (error) {
      console.error('❌ Error storing message:', error.message);
      return false;
    }
  }
  
  /**
   * Get conversation history for a contact
   * @param {string} contactId - GHL contact ID
   * @param {number} limit - Maximum number of recent messages to return
   * @returns {Object} Conversation history
   */
  getConversationHistory(contactId, limit = 10) {
    try {
      if (!contactId) {
        console.log('⚠️ No contact ID provided for conversation history');
        return this._getEmptyConversation();
      }
      
      const conversation = this._loadConversation(contactId);
      
      if (conversation.messages.length === 0) {
        return conversation;
      }
      
      // Return recent messages (limited)
      const recentMessages = conversation.messages.slice(-limit);
      
      console.log(`🧠 Retrieved ${recentMessages.length} messages for contact ${contactId}`);
      
      return {
        ...conversation,
        messages: recentMessages,
        total_messages: conversation.messages.length
      };
      
    } catch (error) {
      console.error('❌ Error retrieving conversation history:', error.message);
      return this._getEmptyConversation();
    }
  }
  
  /**
   * Get conversation context for AI (formatted for ChatGPT)
   * @param {string} contactId - GHL contact ID
   * @param {number} limit - Number of recent messages to include
   * @returns {Array} Array of messages in OpenAI format
   */
  getConversationContext(contactId, limit = 8) {
    try {
      const conversation = this.getConversationHistory(contactId, limit);
      
      if (conversation.messages.length === 0) {
        return [];
      }
      
      // Convert to OpenAI chat format
      const contextMessages = conversation.messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: this._formatMessageForContext(msg)
      }));
      
      console.log(`🤖 Prepared ${contextMessages.length} context messages for AI`);
      return contextMessages;
      
    } catch (error) {
      console.error('❌ Error preparing conversation context:', error.message);
      return [];
    }
  }
  
  /**
   * Check if this is a new conversation (first message)
   * @param {string} contactId - GHL contact ID
   * @returns {boolean} True if new conversation
   */
  isNewConversation(contactId) {
    try {
      const conversation = this._loadConversation(contactId);
      const isNew = conversation.messages.length === 0;
      
      console.log(`🆕 Contact ${contactId} ${isNew ? 'is new' : 'has existing'} conversation`);
      return isNew;
      
    } catch (error) {
      console.error('❌ Error checking conversation status:', error.message);
      return true; // Assume new if error
    }
  }
  
  /**
   * Get conversation summary for debugging
   * @param {string} contactId - GHL contact ID
   * @returns {Object} Conversation summary
   */
  getConversationSummary(contactId) {
    try {
      const conversation = this._loadConversation(contactId);
      
      if (conversation.messages.length === 0) {
        return {
          contact_id: contactId,
          status: 'no_conversation',
          message_count: 0
        };
      }
      
      const lastMessage = conversation.messages[conversation.messages.length - 1];
      const firstMessage = conversation.messages[0];
      
      // Count message types
      const messageTypes = {};
      const roleCount = { user: 0, assistant: 0 };
      
      for (const msg of conversation.messages) {
        const type = msg.metadata.message_type || 'text';
        messageTypes[type] = (messageTypes[type] || 0) + 1;
        roleCount[msg.role] = (roleCount[msg.role] || 0) + 1;
      }
      
      return {
        contact_id: contactId,
        contact_name: lastMessage.metadata.contact_name || 'Unknown',
        message_count: conversation.messages.length,
        first_message: firstMessage.timestamp,
        last_message: lastMessage.timestamp,
        message_types: messageTypes,
        role_count: roleCount,
        last_content_preview: lastMessage.content.substring(0, 100),
        conversation_age_hours: this._getConversationAgeHours(firstMessage.timestamp),
        channel: lastMessage.metadata.channel || 'SMS'
      };
      
    } catch (error) {
      console.error('❌ Error getting conversation summary:', error.message);
      return {
        contact_id: contactId,
        status: 'error',
        error: error.message
      };
    }
  }
  
  /**
   * Clean old conversations to save storage
   */
  async cleanOldConversations() {
    try {
      if (!fs.existsSync(this.memoryDir)) {
        return { cleaned: 0, total: 0 };
      }
      
      const files = fs.readdirSync(this.memoryDir).filter(f => f.endsWith('.json'));
      let cleaned = 0;
      
      console.log(`🧹 Cleaning ${files.length} conversation files...`);
      
      for (const file of files) {
        try {
          const filePath = path.join(this.memoryDir, file);
          const conversation = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          
          const lastUpdated = new Date(conversation.last_updated || 0);
          const age = Date.now() - lastUpdated.getTime();
          
          if (age > this.maxConversationAge) {
            fs.unlinkSync(filePath);
            cleaned++;
            console.log(`🗑️ Removed old conversation: ${file}`);
          }
        } catch (fileError) {
          console.error(`⚠️ Error processing ${file}:`, fileError.message);
        }
      }
      
      console.log(`✅ Cleaned ${cleaned} old conversations out of ${files.length} total`);
      
      return {
        cleaned: cleaned,
        total: files.length,
        remaining: files.length - cleaned
      };
      
    } catch (error) {
      console.error('❌ Error cleaning conversations:', error.message);
      return { cleaned: 0, total: 0, error: error.message };
    }
  }
  
  /**
   * Get conversation statistics
   */
  getStatistics() {
    try {
      if (!fs.existsSync(this.memoryDir)) {
        return { total_conversations: 0 };
      }
      
      const files = fs.readdirSync(this.memoryDir).filter(f => f.endsWith('.json'));
      let totalMessages = 0;
      let activeConversations = 0;
      let totalSizeKB = 0;
      
      for (const file of files) {
        try {
          const filePath = path.join(this.memoryDir, file);
          const stats = fs.statSync(filePath);
          totalSizeKB += stats.size / 1024;
          
          const conversation = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          totalMessages += conversation.message_count || 0;
          
          const lastUpdated = new Date(conversation.last_updated || 0);
          const age = Date.now() - lastUpdated.getTime();
          const isActive = age < (24 * 60 * 60 * 1000); // Active in last 24 hours
          
          if (isActive) activeConversations++;
          
        } catch (fileError) {
          console.error(`⚠️ Error reading ${file}:`, fileError.message);
        }
      }
      
      return {
        total_conversations: files.length,
        active_conversations: activeConversations,
        total_messages: totalMessages,
        storage_size_kb: Math.round(totalSizeKB),
        average_messages_per_conversation: files.length > 0 ? Math.round(totalMessages / files.length) : 0
      };
      
    } catch (error) {
      console.error('❌ Error getting statistics:', error.message);
      return { total_conversations: 0, error: error.message };
    }
  }
  
  /**
   * Load conversation from file
   * @private
   */
  _loadConversation(contactId) {
    try {
      const conversationFile = this._getConversationFile(contactId);
      
      if (fs.existsSync(conversationFile)) {
        const data = fs.readFileSync(conversationFile, 'utf8');
        return JSON.parse(data);
      }
      
      // Return empty conversation structure
      return this._getEmptyConversation(contactId);
      
    } catch (error) {
      console.error('❌ Error loading conversation:', error.message);
      return this._getEmptyConversation(contactId);
    }
  }
  
  /**
   * Get empty conversation structure
   * @private
   */
  _getEmptyConversation(contactId = null) {
    return {
      contact_id: contactId,
      created: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      message_count: 0,
      messages: []
    };
  }
  
  /**
   * Get conversation file path
   * @private
   */
  _getConversationFile(contactId) {
    return path.join(this.memoryDir, `${contactId}.json`);
  }
  
  /**
   * Ensure memory directory exists
   * @private
   */
  _ensureMemoryDirectory() {
    try {
      if (!fs.existsSync(this.memoryDir)) {
        fs.mkdirSync(this.memoryDir, { recursive: true });
        console.log('📁 Created conversation memory directory');
      }
    } catch (error) {
      console.error('❌ Failed to create memory directory:', error.message);
    }
  }
  
  /**
   * Generate unique message ID
   * @private
   */
  _generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Format message for AI context
   * @private
   */
  _formatMessageForContext(message) {
    let content = message.content;
    
    // Add metadata context for non-text messages
    if (message.metadata.message_type === 'voice') {
      content = `[Audio transcription]: ${content}`;
    } else if (message.metadata.message_type === 'image') {
      content = `[Image analysis]: ${content}`;
    }
    
    return content;
  }
  
  /**
   * Get conversation age in hours
   * @private
   */
  _getConversationAgeHours(firstTimestamp) {
    try {
      const firstTime = new Date(firstTimestamp);
      const now = new Date();
      return Math.round((now - firstTime) / (1000 * 60 * 60));
    } catch {
      return 0;
    }
  }
  
  /**
   * Delete specific conversation
   */
  deleteConversation(contactId) {
    try {
      const conversationFile = this._getConversationFile(contactId);
      
      if (fs.existsSync(conversationFile)) {
        fs.unlinkSync(conversationFile);
        console.log(`🗑️ Deleted conversation for contact ${contactId}`);
        return true;
      }
      
      console.log(`⚠️ No conversation found for contact ${contactId}`);
      return false;
      
    } catch (error) {
      console.error('❌ Error deleting conversation:', error.message);
      return false;
    }
  }
}

module.exports = new ConversationMemoryService();