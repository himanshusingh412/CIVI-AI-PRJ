export const OFFICERS = [
  'Suresh Kumar (Ward 4)',
  'Priya Sharma (Zone B)',
  'Amit Verma (District HQ)',
  'Neha Singh (Block C)',
  'Rajesh Patel (Zone A)'
];

export const RESPONSES = {
  en: {
    greeting: "Namaste! 🙏 I'm CivicAI, your government helpline assistant. How can I help you today?",
    menu: "Please choose an option:",
    askCategory: "Please select the category of your complaint:",
    askDescription: "Please describe your issue in detail. The more information you provide, the faster it can be resolved.",
    emergency: "🚨 EMERGENCY DETECTED! Connecting you to emergency services immediately.\n\nPlease call:\n• Police: 100\n• Ambulance: 108\n• Fire: 101\n• Women Helpline: 1091\n\nYour location is being logged for emergency response.",
    officer: "Connecting you to the next available officer...\n\nOfficer Priya Sharma (Zone B) will be with you shortly. Estimated wait time: 3-5 minutes.",
    statusPrompt: "Please enter your Complaint ID (format: CIV-YYYYMMDD-XXX) to check status.",
    notFound: "No complaint found with that ID. Please check the ID and try again.",
    categories: ['💧 Water Supply', '🛣️ Roads & Transport', '⚡ Electricity', '🏥 Healthcare', '🗑️ Sanitation', '🚓 Law & Order', 'General']
  },
  hi: {
    greeting: "नमस्ते! 🙏 मैं CivicAI हूं, आपकी सरकारी हेल्पलाइन सहायक। आज मैं आपकी कैसे मदद कर सकता हूं?",
    menu: "कृपया एक विकल्प चुनें:",
    askCategory: "कृपया अपनी शिकायत की श्रेणी चुनें:",
    askDescription: "कृपया अपनी समस्या विस्तार से बताएं। जितनी अधिक जानकारी देंगे, उतनी जल्दी समाधान होगा।",
    emergency: "🚨 आपातकाल! आपको आपातकालीन सेवाओं से तुरंत जोड़ा जा रहा है।\n\nकृपया कॉल करें:\n• पुलिस: 100\n• एम्बुलेंस: 108\n• अग्निशमन: 101\n• महिला हेल्पलाइन: 1091",
    officer: "आपको अगले उपलब्ध अधिकारी से जोड़ा जा रहा है...\n\nअधिकारी प्रिया शर्मा (क्षेत्र B) शीघ्र ही आपसे बात करेंगी।",
    statusPrompt: "स्थिति जांचने के लिए अपनी शिकायत ID दर्ज करें (फॉर्मेट: CIV-YYYYMMDD-XXX)।",
    notFound: "उस ID से कोई शिकायत नहीं मिली। कृपया ID जांचकर पुनः प्रयास करें।",
    categories: ['💧 जल आपूर्ति', '🛣️ सड़क व परिवहन', '⚡ बिजली', '🏥 स्वास्थ्य सेवा', '🗑️ स्वच्छता', '🚓 कानून व्यवस्था', 'सामान्य']
  }
};
