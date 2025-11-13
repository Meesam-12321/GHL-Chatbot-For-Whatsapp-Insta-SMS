const FixedPricingService = require('./services/pricingService');

async function testSearch() {
  console.log('🧪 Testing Fixed Pricing Service...\n');
  
  const testQueries = [
    'iPhone 14 pantalla',
    'pantalla iPhone 14', 
    'iPhone 14 screen',
    'And the screen of iPhone 14?',
    'iPhone 14',
    'iPhone 14 Pro', // Should NOT return regular iPhone 14
    'iPhone 14 Pro Max' // Should NOT return regular iPhone 14
  ];
  
  for (const query of testQueries) {
    console.log(`\n🔍 Testing: "${query}"`);
    console.log('='.repeat(50));
    
    try {
      const results = await FixedPricingService.searchProducts(query, 5);
      
      if (results.length > 0) {
        console.log(`✅ Found ${results.length} products:`);
        
        results.forEach((item, index) => {
          const productName = item.Prod || 'Unknown';
          const price = item['PUBLICO TIENDA'] || 'N/A';
          const similarity = item._similarity ? (item._similarity * 100).toFixed(1) + '%' : '';
          const score = item._score ? `Score: ${item._score}` : '';
          
          console.log(`   ${index + 1}. ${productName} - ${price} UYU ${similarity} ${score}`);
        });
        
        // Check if iPhone 14 query returned Pro variants (should NOT happen)
        if (query.includes('iPhone 14') && !query.includes('Pro')) {
          const proResults = results.filter(item => 
            item.Prod.toLowerCase().includes('pro')
          );
          
          if (proResults.length > 0) {
            console.log(`⚠️ WARNING: iPhone 14 query returned ${proResults.length} Pro variants`);
            console.log('   This should NOT happen - filtering needs improvement');
          } else {
            console.log('✅ Good: No Pro variants returned for iPhone 14 query');
          }
        }
        
      } else {
        console.log('❌ No results found');
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n🎯 Test complete!');
  console.log('\nExpected behaviors:');
  console.log('✅ "iPhone 14 pantalla" should find iPhone 14 screen products');
  console.log('✅ "iPhone 14" should NOT return iPhone 14 Pro products');
  console.log('✅ "iPhone 14 Pro" should ONLY return iPhone 14 Pro products');
  console.log('✅ Embedding similarity threshold lowered to 0.15');
  console.log('✅ Keyword fallback for failed embedding searches');
}

// Run test
testSearch().catch(console.error);