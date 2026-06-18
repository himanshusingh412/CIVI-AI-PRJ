import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageSquare, 
  LayoutDashboard, 
  Search, 
  MapPin, 
  Droplet, 
  Zap, 
  Trash2, 
  ShieldAlert, 
  Bell, 
  User, 
  ArrowRight,
  Mic,
  Send,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronRight,
  AlertTriangle,
  History,
  Download,
  Filter,
  Users,
  TrendingUp,
  FileText,
  Moon,
  Sun,
  Camera,
  Star,
  LogOut,
  Info,
  Smartphone,
  Fingerprint,
  ShieldCheck,
  Award,
  Stars,
  Activity,
  X,
  Phone
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
  Legend,
  PieChart,
  Pie
} from 'recharts';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import { Complaint, ViewType, LangType, ChatMessage, SystemNotification } from './types';
import { OFFICERS, RESPONSES } from './constants';
import { analyzeComplaint, generateResponseTemplates } from './services/aiService';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const SLA_LIMITS: Record<string, number> = {
  '💧 Water Supply': 24 * 3600 * 1000, // 1 day
  '🛣️ Roads & Transport': 72 * 3600 * 1000, // 3 days
  '⚡ Electricity': 12 * 3600 * 1000, // 12 hours
  '🏥 Healthcare': 48 * 3600 * 1000, // 2 days
  '🗑️ Sanitation': 48 * 3600 * 1000, // 2 days
  '🚓 Law & Order': 6 * 3600 * 1000, // 6 hours
  'General': 48 * 3600 * 1000,
  'Default': 48 * 3600 * 1000
};

const DEPARTMENTS: Record<string, string> = {
  '💧 Water Supply': 'Water Department',
  '🛣️ Roads & Transport': 'Roads Department',
  '⚡ Electricity': 'Electricity Board',
  '🏥 Healthcare': 'Municipal Corporation',
  '🗑️ Sanitation': 'Sanitation Department',
  '🚓 Law & Order': 'Police Department',
  'General': 'General Administration'
};

const calculateSLADeadline = (category: string, startTime: number): number => {
  const baseSLA = SLA_LIMITS[category] || SLA_LIMITS.Default;
  let deadline = startTime + baseSLA;
  
  // Check if deadline falls on weekend (Sat=6, Sun=0)
  const deadlineDate = new Date(deadline);
  const day = deadlineDate.getDay();
  
  // If it ends on Saturday, add 48 hours (skip to Monday)
  if (day === 6) {
    deadline += 48 * 3600 * 1000;
  }
  // If it ends on Sunday, add 24 hours (skip to Monday)
  else if (day === 0) {
    deadline += 24 * 3600 * 1000;
  }
  
  return deadline;
};

export default function App() {
  const [view, setView] = useState<ViewType>('chat');
  const [lang, setLang] = useState<LangType>('en');
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [chatStep, setChatStep] = useState<string | null>(null);
  const [pendingComplaint, setPendingComplaint] = useState<Partial<Complaint>>({});
  const [trackId, setTrackId] = useState('');
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dashboardFilter, setDashboardFilter] = useState<'all' | Complaint['status']>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'analytics' | 'workload' | 'heatmap'>('overview');
  const [isListening, setIsListening] = useState(false);
  const [aiSuggestedCategory, setAiSuggestedCategory] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<Complaint | null>(null);
  const [suggestedResponses, setSuggestedResponses] = useState<string[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [showFeedbackModal, setShowFeedbackModal] = useState<Complaint | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loginStep, setLoginStep] = useState<'aadhaar' | 'otp'>('aadhaar');
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [otpValue, setOtpValue] = useState('');
  const [rtiMode, setRtiMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-escalation checker
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setComplaints(prev => prev.map(c => {
        if (c.status !== 'Resolved' && !c.escalated && now > c.deadline) {
          return { ...c, escalated: true, priority: 'Critical' };
        }
        return c;
      }));
    }, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  // Initialize Dark Mode
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Initial notifications
  useEffect(() => {
    setNotifications([
      { id: '1', title: 'Welcome to CivicAI', message: 'Thank you for joining our smart governance platform.', type: 'info', timestamp: '2 hours ago', read: false },
      { id: '2', title: 'Status Update', message: 'Your complaint CIV-20260430-001 has been assigned to an officer.', type: 'success', timestamp: '5 hours ago', read: true },
    ]);
  }, []);

  // Fetch AI Responses when a complaint is selected
  useEffect(() => {
    if (selectedComplaint) {
      const fetchTemplates = async () => {
        const templates = await generateResponseTemplates(selectedComplaint);
        setSuggestedResponses(templates);
      };
      fetchTemplates();
    } else {
      setSuggestedResponses([]);
    }
  }, [selectedComplaint]);

  // Initialize with seed data
  useEffect(() => {
    const seeds: Complaint[] = [
      { id: 'CIV-20260430-001', category: 'Road & Infrastructure', description: 'Large pothole on MG Road near Bus Stand causing accidents', status: 'In Progress', priority: 'High', sentiment: 'Frustrated', officer: OFFICERS[0], date: '30/04/2026', deadline: Date.now() + 86400000, timestamp: Date.now() - 86400000, lat: 28.6139, lng: 77.2090 },
      { id: 'CIV-20260429-002', category: 'Water Supply', description: 'No water supply for 3 days in Sector 14 residential area', status: 'Pending', priority: 'Medium', sentiment: 'Neutral', officer: OFFICERS[1], date: '29/04/2026', deadline: Date.now() + 43200000, timestamp: Date.now() - 172800000, lat: 28.6210, lng: 77.2100 },
      { id: 'CIV-20260428-003', category: 'Sanitation', description: 'Garbage not collected for a week near Park Street', status: 'Resolved', priority: 'Low', sentiment: 'Polite', officer: OFFICERS[2], date: '28/04/2026', deadline: Date.now() - 10000, timestamp: Date.now() - 259200000, lat: 28.6100, lng: 77.2200 },
    ];
    setComplaints(seeds);
    
    // Greeting
    botReply(RESPONSES[lang].greeting, 500);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const generateID = () => {
    const d = new Date();
    const ymd = d.getFullYear().toString() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    const seq = String(complaints.length + 1).padStart(3, '0');
    return `CIV-${ymd}-${seq}`;
  };

  const botReply = (content: string, delay = 800) => {
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        content,
        type: 'bot',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    }, delay);
  };

  const handleSendMessage = (text: string) => {
    if (!text.trim()) return;
    
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      content: text,
      type: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    setMessages(prev => [...prev, userMsg]);
    processUserInput(text);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPendingComplaint(prev => ({ ...prev, photoUrl: reader.result as string }));
        botReply("📸 Photo attached! Now, let's finalize the category.");
      };
      reader.readAsDataURL(file);
    }
  };

  const processUserInput = async (text: string) => {
    const r = RESPONSES[lang];
    const lower = text.toLowerCase();

    // Emergency
    if (lower.includes('emergency') || lower.includes('आपातकाल') || lower.includes('urgent') || lower.includes('help me')) {
      setChatStep(null);
      botReply(r.emergency);
      return;
    }

    // RTI Flow
    if (lower.includes('rti') || lower.includes('right to information') || lower.includes('सूचना का अधिकार')) {
      setRtiMode(true);
      setChatStep('rti_subject');
      botReply("Starting RTI request flow. What is the subject of your information request?");
      return;
    }

    if (chatStep === 'rti_subject') {
      setChatStep('rti_dept');
      botReply(`Understood. Which department are you requesting information from? (e.g., PWD, Education, Health)`);
      return;
    }

    if (chatStep === 'rti_dept') {
      setChatStep(null);
      setRtiMode(false);
      const rtiId = `RTI-${Date.now().toString().slice(-6)}`;
      botReply(`✅ RTI Request Filed!\n\nReference ID: ${rtiId}\n\nUnder the RTI Act 2005, you will receive a response within 30 days.`);
      showToast("RTI request submitted!");
      return;
    }

    // Main Flows
    if (!chatStep) {
      if (lower.includes('register') || lower.includes('complaint') || lower.includes('शिकायत')) {
        setChatStep('ask_category_explicit');
        botReply("Sure! What category does your complaint fall under?");
        return;
      }
      if (lower.includes('status') || lower.includes('check') || lower.includes('track') || lower.includes('स्थिति')) {
        setChatStep('check_status');
        botReply(r.statusPrompt);
        return;
      }
      if (lower.includes('officer') || lower.includes('human') || lower.includes('अधिकारी')) {
        botReply(r.officer);
        return;
      }
      
      botReply(r.menu + "\n\n📝 Register a new complaint\n🔍 Check complaint status\n🚨 Emergency assistance\n👮 Talk to an officer");
      return;
    }

    // Explicit Category Selection
    if (chatStep === 'ask_category_explicit') {
      const category = r.categories.find(c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()));
      if (category) {
        setPendingComplaint({ category });
        setChatStep('ask_description_manual');
        botReply(category.includes('Water') ? 'Water Supply issue noted. Please describe the problem:' : 
                 category.includes('Road') ? 'Road issue noted. Please describe the problem:' :
                 category.includes('Electricity') ? 'Electricity issue noted. Please describe the problem:' :
                 category.includes('Sanitation') ? 'Sanitation issue noted (garbage, cleaning, etc.). Please describe:' :
                 category.includes('Law') ? 'Law & Order issue noted. Please describe the situation:' :
                 'Issue noted. Please describe the problem:');
      } else {
        botReply("Please select a category from the list below.");
      }
      return;
    }

    if (chatStep === 'ask_description_manual') {
      setPendingComplaint(prev => ({ ...prev, description: text }));
      setChatStep('ask_photo');
      botReply("Would you like to upload a photo for faster resolution?");
      return;
    }

    // New Flow: Description First (Keep as AI backup or alternative)
    if (chatStep === 'ask_description_first') {
      setIsTyping(true);
      const analysis = await analyzeComplaint(text);
      setIsTyping(false);
      
      setPendingComplaint({ description: text, category: analysis.category });
      setAiSuggestedCategory(analysis.category);
      setChatStep('ask_photo');
      
      botReply(`I've categorized this as "${analysis.category}". Would you like to upload a photo of the issue for faster resolution?`);
      return;
    }

    if (chatStep === 'ask_photo') {
      if (text.toLowerCase().includes('skip') || text.toLowerCase().includes('no')) {
        setChatStep('confirm_category');
        botReply("No problem. Please confirm the category is correct to proceed.");
      } else {
        botReply("Please use the attachment icon to upload a photo, or say 'skip' to continue.");
      }
      return;
    }

    if (chatStep === 'confirm_category') {
      const finalCategory = text;
      const finalDescription = pendingComplaint.description || "";
      
      setIsTyping(true);
      const id = generateID();
      const officer = OFFICERS[Math.floor(Math.random() * OFFICERS.length)];
      
      const analysis = await analyzeComplaint(finalDescription);
      
      const newComplaint: Complaint = {
        id,
        category: finalCategory,
        description: finalDescription,
        status: analysis.priority === 'Critical' ? 'Emergency' : 'Pending',
        priority: analysis.priority,
        sentiment: analysis.sentiment,
        photoUrl: pendingComplaint.photoUrl,
        officer,
        date: new Date().toLocaleDateString('en-IN'),
        deadline: calculateSLADeadline(finalCategory, Date.now()),
        timestamp: Date.now(),
        department: DEPARTMENTS[finalCategory] || 'General Administration',
        lat: 28.6139 + (Math.random() - 0.5) * 0.1,
        lng: 77.2090 + (Math.random() - 0.5) * 0.1
      };
      
      setComplaints(prev => [newComplaint, ...prev]);
      setChatStep(null);
      setPendingComplaint({});
      setAiSuggestedCategory(null);
      setDuplicateWarning(null);
      setIsTyping(false);
      botReply(`✅ Registration Complete!\n\nID: ${id}\nPriority: ${newComplaint.priority}\n\nAssigned to ${officer}.`);
      showToast("Complaint registered!");
      return;
    }

    if (chatStep === 'check_status') {
      const found = complaints.find(c => c.id === text.toUpperCase().trim());
      setChatStep(null);
      if (found) {
        botReply(`Found your complaint!\n\n🆔 ID: ${found.id}\n📊 Status: ${found.status}\n📅 Filed: ${found.date}\n👮 Officer: ${found.officer}`);
      } else {
        botReply(r.notFound);
      }
    }
  };

  const updateComplaintStatus = (id: string, nextStatus: Complaint['status']) => {
    setComplaints(prev => prev.map(c => c.id === id ? { ...c, status: nextStatus } : c));
    showToast(`Status updated to ${nextStatus}`);
    
    if (nextStatus === 'Resolved') {
      const cmp = complaints.find(c => c.id === id);
      if (cmp) setShowFeedbackModal(cmp);
    }

    const n: SystemNotification = {
      id: Date.now().toString(),
      title: 'Status Update',
      message: `Complaint ${id} is now ${nextStatus}`,
      type: 'info',
      timestamp: 'Just now',
      read: false
    };
    setNotifications(prev => [n, ...prev]);

    setSelectedComplaint(null);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Complaint Update", { body: `Complaint ${id} is now ${nextStatus}` });
    }
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Speech recognition not supported");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = lang === 'en' ? 'en-US' : 'hi-IN';
    recognition.start();
    setIsListening(true);
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      if (chatInputRef.current) chatInputRef.current.value = transcript;
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
  };

  const stats = {
    total: complaints.length,
    pending: complaints.filter(c => c.status === 'Pending').length,
    progress: complaints.filter(c => c.status === 'In Progress').length,
    resolved: complaints.filter(c => c.status === 'Resolved').length,
  };

  // Analytics Data
  const categoryData = RESPONSES.en.categories.map(cat => ({
    name: cat,
    count: complaints.filter(c => c.category === cat).length
  })).filter(d => d.count > 0);

  const volumeData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toLocaleDateString('en-IN');
    return {
      date: dateStr.split('/')[0] + '/' + dateStr.split('/')[1],
      count: complaints.filter(c => c.date === dateStr).length
    };
  });

  const officerWorkload = OFFICERS.map(name => {
    const assigned = complaints.filter(c => c.officer === name);
    const solved = assigned.filter(c => c.status === 'Resolved').length;
    return {
      name: name.split(' (')[0],
      ward: name.split(' (')[1]?.replace(')', '') || 'HQ',
      count: assigned.length,
      solved,
      pending: assigned.length - solved,
      rating: assigned.length === 0 ? 5 : Math.min(5, 4 + (solved / (assigned.length || 1)))
    };
  });

  const filteredComplaints = complaints
    .filter(c => dashboardFilter === 'all' || c.status === dashboardFilter)
    .filter(c => 
      c.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const exportToCSV = () => {
    const headers = ['ID', 'Category', 'Description', 'Officer', 'Date', 'Status'];
    const rows = filteredComplaints.map(c => [
      c.id,
      c.category,
      `"${c.description.replace(/"/g, '""')}"`,
      c.officer,
      c.date,
      c.status
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n"
      + rows.map(r => r.join(",")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `civicai_complaints_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Exporting CSV...");
  };

  if (!isAuthenticated) {
    return (
      <div className="h-screen w-full bg-navy flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full opacity-10">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-saffron rounded-full blur-[100px] animate-pulse"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white rounded-full blur-[100px] animate-pulse"></div>
        </div>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl relative z-10"
        >
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-navy rounded-2xl flex items-center justify-center mx-auto mb-4 text-white">
              <ShieldCheck size={32} />
            </div>
            <h1 className="font-display font-bold text-2xl text-navy">CivicAI Login</h1>
            <p className="text-gray-400 text-sm">Citizen Social Authentication</p>
          </div>

          <div className="space-y-6">
            {loginStep === 'aadhaar' ? (
              <div className="space-y-4">
                <div className="relative">
                  <Fingerprint className="absolute left-4 top-3.5 text-gray-400" size={18} />
                  <input 
                    type="text" 
                    placeholder="Enter 12-digit Aadhaar Number"
                    value={aadhaarNumber}
                    onChange={(e) => setAadhaarNumber(e.target.value)}
                    className="w-full h-12 pl-12 pr-4 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-navy outline-none text-sm transition-all"
                  />
                </div>
                <button 
                  onClick={() => setLoginStep('otp')}
                  className="w-full h-12 bg-navy text-white rounded-xl font-bold hover:bg-saffron transition-all flex items-center justify-center gap-2"
                >
                  Request OTP <ChevronRight size={18} />
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                 <div className="relative">
                  <Smartphone className="absolute left-4 top-3.5 text-gray-400" size={18} />
                  <input 
                    type="text" 
                    placeholder="Enter 4-digit OTP"
                    value={otpValue}
                    onChange={(e) => setOtpValue(e.target.value)}
                    className="w-full h-12 pl-12 pr-4 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-navy outline-none text-sm tracking-[1em] font-bold transition-all text-center"
                  />
                </div>
                <button 
                  onClick={() => {
                    setIsAuthenticated(true);
                    showToast("Login Successful!");
                    setShowOnboarding(true);
                  }}
                  className="w-full h-12 bg-navy text-white rounded-xl font-bold hover:bg-saffron transition-all flex items-center justify-center gap-2"
                >
                  Verify & Access <ChevronRight size={18} />
                </button>
                <button onClick={() => setLoginStep('aadhaar')} className="w-full text-xs font-bold text-gray-400 hover:text-navy uppercase tracking-widest text-center mt-2">Change Aadhaar Number</button>
              </div>
            )}
            <div className="flex items-center gap-2 text-[10px] text-gray-400 font-bold uppercase tracking-widest justify-center mt-4">
              <ShieldCheck size={12} className="text-green-500" />
              Verified Govt System
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50 text-navy transition-colors duration-300 dark:bg-[#0a0f1d] dark:text-[#f8f9fc]">
      {/* Top Navigation */}
      <nav className="h-20 bg-white dark:bg-[#111827] border-b border-gray-100 dark:border-gray-800 px-8 flex items-center justify-between shrink-0 relative z-[100]">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-navy rounded-xl flex items-center justify-center text-white shadow-lg shadow-navy/20 dark:shadow-none">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight">CivicAI</h1>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">New Delhi Municipal Council</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex bg-gray-50 dark:bg-gray-800 rounded-xl p-1 border border-gray-100 dark:border-gray-700">
            <button onClick={() => setLang('en')} className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${lang === 'en' ? 'bg-white dark:bg-gray-700 text-navy shadow-sm' : 'text-gray-400 hover:text-navy'}`}>EN</button>
            <button onClick={() => setLang('hi')} className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${lang === 'hi' ? 'bg-white dark:bg-gray-700 text-navy shadow-sm' : 'text-gray-400 hover:text-navy'}`}>HI</button>
          </div>

          <div className="h-6 w-px bg-gray-100 dark:bg-gray-800"></div>

          <div className="flex items-center gap-4">
            <button onClick={() => setIsDarkMode(!isDarkMode)} className="w-10 h-10 rounded-xl border border-gray-100 dark:border-gray-800 flex items-center justify-center text-gray-400 hover:text-navy dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-all">
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            
            <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative w-10 h-10 rounded-xl border border-gray-100 dark:border-gray-800 flex items-center justify-center text-gray-400 hover:text-navy dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
              >
                <Bell size={18} />
                {notifications.some(n => !n.read) && (
                  <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-saffron rounded-full border-2 border-white dark:border-[#111827]"></span>
                )}
              </button>

              <AnimatePresence>
                {showNotifications && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden z-[100]"
                  >
                    <div className="p-4 border-b border-gray-50 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                      <span className="text-[10px] font-black uppercase tracking-widest text-navy dark:text-gray-300">Notifications</span>
                      <button className="text-[10px] font-bold text-saffron uppercase">Mark all read</button>
                    </div>
                    <div className="max-h-[300px] overflow-auto">
                      {notifications.map(n => (
                        <div key={n.id} className={`p-4 border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all cursor-pointer ${!n.read ? 'bg-saffron/5' : ''}`}>
                          <h4 className="text-xs font-bold text-navy dark:text-white">{n.title}</h4>
                          <p className="text-[11px] text-gray-500 mt-0.5">{n.message}</p>
                          <span className="text-[9px] font-bold text-gray-400 mt-2 block">{n.timestamp}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={() => setView('dashboard')}
              className={`flex items-center gap-2 px-4 h-10 rounded-xl text-xs font-bold transition-all ${view === 'dashboard' ? 'bg-navy text-white' : 'bg-white dark:bg-transparent border border-gray-200 dark:border-gray-800 text-gray-500 hover:border-navy hover:text-navy'}`}
            >
              <LayoutDashboard size={16} /> Dashboard
            </button>
            <button onClick={() => setIsAuthenticated(false)} className="w-10 h-10 rounded-xl text-gray-300 hover:text-red-500 transition-all">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[240px] bg-white border-r border-gray-100 flex flex-col py-6 shrink-0">
          <div className="px-5 mb-2 text-[10px] font-bold text-gray-400 tracking-[0.15em] uppercase">Main Menu</div>
          <SidebarItem 
            active={view === 'chat'} 
            onClick={() => setView('chat')} 
            icon={<MessageSquare size={18} />} 
            label={lang === 'en' ? 'AI Assistant' : 'AI सहायक'} 
          />
          <SidebarItem 
            active={view === 'dashboard'} 
            onClick={() => setView('dashboard')} 
            icon={<LayoutDashboard size={18} />} 
            label={lang === 'en' ? 'Officer Dashboard' : 'अधिकारी डैशबोर्ड'} 
            badge={stats.pending}
          />
          <SidebarItem 
            active={view === 'track'} 
            onClick={() => setView('track')} 
            icon={<Search size={18} />} 
            label={lang === 'en' ? 'Track Complaint' : 'शिकायत ट्रैक करें'} 
          />
          <SidebarItem 
            active={view === 'public_feed'} 
            onClick={() => setView('public_feed')} 
            icon={<TrendingUp size={18} />} 
            label={lang === 'en' ? 'Transparency Feed' : 'ट्रांसपेरेंसी फीड'} 
          />

          <div className="px-5 mt-6 mb-2 text-[10px] font-bold text-gray-400 tracking-[0.15em] uppercase">Categories</div>
          <SidebarItem 
            icon={<MapPin size={18} />} 
            label={lang === 'en' ? 'Roads & Infra' : 'सड़क व ढांचा'} 
            onClick={() => { setView('chat'); setChatStep('ask_description_manual'); setPendingComplaint({ category: '🛣️ Roads & Transport' }); botReply("Reporting Road issue. Please describe the problem:"); }}
          />
          <SidebarItem 
            icon={<Droplet size={18} />} 
            label={lang === 'en' ? 'Water Supply' : 'जल आपूर्ति'} 
            onClick={() => { setView('chat'); setChatStep('ask_description_manual'); setPendingComplaint({ category: '💧 Water Supply' }); botReply("Reporting Water Supply issue. Please describe the problem:"); }}
          />
          <SidebarItem 
            icon={<Zap size={18} />} 
            label={lang === 'en' ? 'Electricity' : 'बिजली'} 
            onClick={() => { setView('chat'); setChatStep('ask_description_manual'); setPendingComplaint({ category: '⚡ Electricity' }); botReply("Reporting Electricity issue. Please describe the problem:"); }}
          />
          <SidebarItem 
            icon={<Trash2 size={18} />} 
            label={lang === 'en' ? 'Sanitation' : 'स्वच्छता'} 
            onClick={() => { setView('chat'); setChatStep('ask_description_manual'); setPendingComplaint({ category: '🗑️ Sanitation' }); botReply("Reporting Sanitation issue. Please describe the problem:"); }}
          />
          <SidebarItem 
            icon={<ShieldAlert size={18} />} 
            label={lang === 'en' ? 'Law & Order' : 'कानून व्यवस्था'} 
            onClick={() => { setView('chat'); setChatStep('ask_description_manual'); setPendingComplaint({ category: '🚓 Law & Order' }); botReply("Reporting Law & Order issue. Please describe the problem:"); }}
          />
          
          <div className="mt-auto px-4">
            <button 
              onClick={() => { setView('chat'); processUserInput('emergency'); }}
              className="w-full py-2.5 bg-gradient-to-br from-red-500 to-red-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-red-200 hover:-translate-y-0.5 transition-all active:scale-95"
            >
              <AlertTriangle size={14} /> 
              {lang === 'en' ? 'EMERGENCY HELP' : 'आपातकालीन सहायता'}
            </button>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-hidden p-6 flex flex-col">
          <AnimatePresence mode="wait">
            {view === 'chat' && (
              <motion.div 
                key="chat"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex-1 flex flex-col gap-4 overflow-hidden"
              >
                <div className="flex items-center gap-4 pb-4 border-b border-gray-100">
                  <div className="w-12 h-12 bg-navy rounded-2xl flex items-center justify-center text-2xl shadow-md">🤖</div>
                  <div>
                    <h2 className="font-display font-bold text-lg">{lang === 'en' ? 'CivicAI Assistant' : 'CivicAI सहायक'}</h2>
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                      {lang === 'en' ? 'Online • Govt. Verified System' : 'ऑनलाइन • सरकारी प्रणाली'}
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-4 py-4">
                  {messages.map(m => (
                    <div key={m.id} className={`flex gap-3 ${m.type === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 border border-gray-100 ${m.type === 'bot' ? 'bg-navy text-white' : 'bg-saffron text-white'}`}>
                        {m.type === 'bot' ? '🤖' : 'RC'}
                      </div>
                      <div className="flex flex-col max-w-[75%]">
                        <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm whitespace-pre-line relative overflow-hidden ${
                          m.type === 'bot' 
                            ? 'bg-white dark:bg-gray-800 text-navy dark:text-white border-b-4 border-gray-100 dark:border-gray-900' 
                            : 'bg-navy dark:bg-saffron text-white rounded-tr-none'
                        }`}>
                          {m.content}
                          {m.content.includes("Photo attached!") && pendingComplaint.photoUrl && (
                            <img src={pendingComplaint.photoUrl} className="mt-2 rounded-lg max-h-40 w-full object-cover border border-gray-100" alt="Complaint Attachment" />
                          )}
                        </div>
                        <span className={`text-[10px] text-gray-400 mt-1 ${m.type === 'user' ? 'text-right' : ''}`}>{m.timestamp}</span>
                      </div>
                    </div>
                  ))}
                  {isTyping && (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-navy flex items-center justify-center text-sm text-white shrink-0">🤖</div>
                      <div className="bg-white p-3 pr-6 rounded-2xl flex gap-1 shadow-sm">
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-typing"></div>
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-typing delay-75"></div>
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-typing delay-150"></div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Chat Controls */}
                <div className="flex flex-col gap-2 pt-2">
                  <div className="flex flex-wrap gap-2">
                    {chatStep === 'confirm_category' ? (
                      <div className="flex flex-wrap gap-2">
                         <button 
                          onClick={() => handleSendMessage(aiSuggestedCategory || 'General')}
                          className="px-4 py-1.5 bg-navy text-white rounded-full text-xs font-bold flex items-center gap-1.5 hover:bg-saffron transition-all"
                        >
                          <Award size={12} /> Yes, it's {aiSuggestedCategory}
                        </button>
                        {RESPONSES[lang].categories.filter(c => c !== aiSuggestedCategory).map(cat => (
                          <button 
                            key={cat}
                            onClick={() => handleSendMessage(cat)}
                            className="px-4 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-semibold hover:border-saffron hover:text-saffron transition-all"
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    ) : chatStep === 'ask_category_explicit' ? (
                      <div className="flex flex-wrap gap-2">
                        {RESPONSES[lang].categories.map(cat => (
                          <button 
                            key={cat}
                            onClick={() => handleSendMessage(cat)}
                            className="px-4 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-semibold hover:border-saffron hover:text-saffron transition-all"
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    ) : (
                      ['Register a Complaint', 'Status Check', 'Emergency'].map(label => (
                        <button 
                          key={label}
                          onClick={() => handleSendMessage(lang === 'hi' ? (label === 'Emergency' ? 'आपातकाल' : label === 'Status Check' ? 'स्थिति' : 'शिकायत दर्ज करें') : label)}
                          className="px-4 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-semibold hover:border-saffron hover:text-saffron transition-all"
                        >
                          {label}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl flex items-end p-2 focus-within:border-navy transition-all shadow-sm">
                    <div className="flex items-center gap-1">
                      <label 
                        className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-all ${pendingComplaint.photoUrl ? 'bg-saffron/10 text-saffron' : 'text-gray-400 hover:text-saffron'}`}
                      >
                        <Camera size={18} />
                        <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                      </label>
                      <button 
                        onClick={startListening}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isListening ? 'bg-red-50 text-red-500 animate-pulse' : 'text-gray-400 hover:text-saffron'}`}
                      >
                        <Mic size={18} />
                      </button>
                    </div>
                    <textarea 
                      ref={chatInputRef}
                      placeholder={lang === 'en' ? "Describe your problem..." : "अपनी समस्या बताएं..."}
                      className="flex-1 border-none focus:ring-0 text-sm py-2 px-1 resize-none h-10 max-h-32"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage(e.currentTarget.value);
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                    <button 
                      onClick={() => {
                        if (chatInputRef.current) {
                          handleSendMessage(chatInputRef.current.value);
                          chatInputRef.current.value = '';
                        }
                      }}
                      className="w-10 h-10 bg-navy text-white rounded-full flex items-center justify-center hover:bg-saffron transition-all"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 flex flex-col gap-6 overflow-hidden"
              >
                <div className="flex items-center justify-between shrink-0">
                  <div>
                    <h2 className="font-display font-bold text-2xl">{lang === 'en' ? 'Officer Dashboard' : 'अधिकारी डैशबोर्ड'}</h2>
                    <p className="text-gray-400 text-sm mt-0.5">{lang === 'en' ? 'Track and manage citizen submissions' : 'प्रस्तुतियों को ट्रैक करें और प्रबंधित करें'}</p>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="flex bg-white rounded-xl border border-gray-100 p-1 shadow-sm">
                      <button 
                        onClick={() => setDashboardTab('overview')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'overview' ? 'bg-navy text-white' : 'text-gray-500 hover:text-navy'}`}
                      >Overview</button>
                      <button 
                        onClick={() => setDashboardTab('analytics')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'analytics' ? 'bg-navy text-white' : 'text-gray-500 hover:text-navy'}`}
                      >Analytics</button>
                      <button 
                        onClick={() => setDashboardTab('workload')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'workload' ? 'bg-navy text-white' : 'text-gray-500 hover:text-navy'}`}
                      >Workload</button>
                      <button 
                        onClick={() => setDashboardTab('heatmap')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'heatmap' ? 'bg-navy text-white' : 'text-gray-500 hover:text-navy'}`}
                      >Heatmap</button>
                    </div>
                    <button 
                      onClick={exportToCSV}
                      className="px-4 h-10 bg-white border border-gray-200 rounded-xl text-navy flex items-center gap-2 text-xs font-bold hover:border-navy transition-all shadow-sm"
                    >
                      <Download size={14} /> Export CSV
                    </button>
                  </div>
                </div>

                {dashboardTab === 'overview' && (
                  <div className="flex-1 flex flex-col gap-6 overflow-hidden">
                    <div className="grid grid-cols-4 gap-4 shrink-0">
                      <StatCard label="Total" value={stats.total} icon={<History size={20} />} color="navy" />
                      <StatCard label="Pending" value={stats.pending} icon={<Clock size={20} />} color="orange" />
                      <StatCard label="Progress" value={stats.progress} icon={<Zap size={20} />} color="saffron" />
                      <StatCard label="Resolved" value={stats.resolved} icon={<CheckCircle2 size={20} />} color="green" />
                    </div>

                    <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
                      <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <h3 className="font-bold text-sm tracking-wide shrink-0">COMPLAINT REGISTRY</h3>
                        
                        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                          <div className="relative flex-1 sm:w-64">
                            <Search className="absolute left-3 top-2.5 text-gray-400" size={14} />
                            <input 
                              type="text" 
                              placeholder="Search complaints..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full h-9 pl-9 pr-4 bg-white rounded-lg border border-gray-200 text-xs focus:ring-1 focus:ring-navy focus:border-navy transition-all"
                            />
                          </div>
                          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                            {(['all', 'Pending', 'In Progress', 'Resolved'] as const).map(f => (
                              <button 
                                key={f}
                                onClick={() => setDashboardFilter(f)}
                                className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${
                                  dashboardFilter === f ? 'bg-white text-navy shadow-sm' : 'text-gray-400 hover:text-navy'
                                }`}
                              >
                                {f === 'all' ? 'All' : f}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      
                      <div className="overflow-auto flex-1">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-gray-100 sticky top-0 bg-white z-10">
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">ID</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">Category</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">Description</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">Status</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">SLA Timer</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {filteredComplaints.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-gray-400 text-sm">
                                  No complaints found matching your criteria.
                                </td>
                              </tr>
                            ) : (
                              filteredComplaints.map(c => (
                                <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                                  <td className="px-6 py-4 font-mono text-xs font-bold text-navy">{c.id}</td>
                                  <td className="px-6 py-4 text-xs font-medium">
                                    <div className="flex flex-col gap-1">
                                      {c.category}
                                      <PriorityBadge priority={c.priority} />
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-xs text-gray-500 max-w-[200px] truncate">{c.description}</td>
                                  <td className="px-6 py-4">
                                    <StatusBadge status={c.status} />
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <SLATimer deadline={c.deadline} status={c.status} />
                                  </td>
                                  <td className="px-6 py-4">
                                    <button 
                                      onClick={() => setSelectedComplaint(c)}
                                      className="px-3 py-1.5 bg-navy text-white rounded-lg text-[10px] font-bold hover:bg-saffron transition-all"
                                    >VIEW DETAILS</button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {dashboardTab === 'analytics' && (
                  <div className="flex-1 flex flex-col gap-6 overflow-auto pr-2 pb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="text-saffron" size={20} />
                          <h3 className="font-display font-bold text-sm">Complaints by Category</h3>
                        </div>
                        <div className="h-[300px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={categoryData} layout="vertical" margin={{ left: 20, right: 30 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                              <XAxis type="number" hide />
                              <YAxis 
                                dataKey="name" 
                                type="category" 
                                width={120} 
                                axisLine={false} 
                                tickLine={false}
                                style={{ fontSize: '11px', fontWeight: 600, fill: '#1d3557' }}
                              />
                              <Tooltip 
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                cursor={{ fill: 'transparent' }}
                              />
                              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20}>
                                {categoryData.map((_entry, index) => (
                                  <Cell key={`cell-${index}`} fill={['#1A2B5E', '#FF6B00', '#22C55E', '#3B82F6', '#F59E0B'][index % 5]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="text-navy" size={20} />
                          <h3 className="font-display font-bold text-sm">7-Day Volume Trend</h3>
                        </div>
                        <div className="h-[300px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={volumeData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                              <XAxis 
                                dataKey="date" 
                                axisLine={false} 
                                tickLine={false} 
                                style={{ fontSize: '10px', fill: '#94a3b8' }}
                              />
                              <YAxis 
                                axisLine={false} 
                                tickLine={false} 
                                style={{ fontSize: '10px', fill: '#94a3b8' }}
                              />
                              <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                              <Line 
                                type="monotone" 
                                dataKey="count" 
                                stroke="#FF6B00" 
                                strokeWidth={3} 
                                dot={{ fill: '#FF6B00', strokeWidth: 2, r: 4, stroke: '#fff' }}
                                activeDot={{ r: 6, strokeWidth: 0 }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="font-display font-bold text-sm">Resolution Performance</h3>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-navy"></div>
                            <span className="text-[10px] font-bold text-gray-500 uppercase">Total</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                            <span className="text-[10px] font-bold text-gray-500 uppercase">Resolved</span>
                          </div>
                        </div>
                      </div>
                      <div className="h-[250px] w-full">
                         <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={officerWorkload} barGap={8}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} style={{ fontSize: '10px', fill: '#94a3b8' }} />
                              <YAxis axisLine={false} tickLine={false} style={{ fontSize: '10px', fill: '#94a3b8' }} />
                              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.02)' }} contentStyle={{ borderRadius: '12px' }} />
                              <Bar dataKey="count" name="Total Assigned" fill="#1A2B5E" radius={[4, 4, 0, 0]} barSize={24} />
                              <Bar dataKey="solved" name="Resolved" fill="#22C55E" radius={[4, 4, 0, 0]} barSize={24} />
                            </BarChart>
                         </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {dashboardTab === 'workload' && (
                  <div className="flex-1 overflow-auto pr-2 pb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {officerWorkload.map(off => (
                        <div key={off.name} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col gap-6 hover:shadow-md transition-all group">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-xl grayscale group-hover:grayscale-0 transition-all">👨‍💼</div>
                            <div>
                              <h4 className="font-display font-bold text-navy">{off.name}</h4>
                              <p className="text-[10px] font-bold text-saffron uppercase tracking-widest">{off.ward}</p>
                            </div>
                            <div className="ml-auto bg-yellow-50 text-yellow-600 px-2 py-1 rounded-lg flex items-center gap-1 text-xs font-bold">
                              ★ {off.rating.toFixed(1)}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-3">
                            <div className="p-3 bg-gray-50 rounded-2xl flex flex-col gap-1">
                              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Assigned</span>
                              <span className="text-xl font-display font-bold text-navy">{off.count}</span>
                            </div>
                            <div className="p-3 bg-green-50 rounded-2xl flex flex-col gap-1">
                              <span className="text-[9px] font-bold text-green-400 uppercase tracking-tighter">Solved</span>
                              <span className="text-xl font-display font-bold text-green-600">{off.solved}</span>
                            </div>
                            <div className="p-3 bg-orange-50 rounded-2xl flex flex-col gap-1">
                              <span className="text-[9px] font-bold text-orange-400 uppercase tracking-tighter">Pending</span>
                              <span className="text-xl font-display font-bold text-orange-600">{off.pending}</span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2">
                             <div className="flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase">
                               <span>Efficiency Rate</span>
                               <span>{off.count === 0 ? 0 : Math.round((off.solved / off.count) * 100)}%</span>
                             </div>
                             <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${off.count === 0 ? 0 : (off.solved / off.count) * 100}%` }}
                                  className="h-full bg-navy rounded-full"
                                ></motion.div>
                             </div>
                          </div>
                          
                          <button className="w-full py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-navy hover:bg-navy hover:text-white hover:border-navy transition-all">View Performance Report</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {dashboardTab === 'heatmap' && (
                  <div className="flex-1 bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden flex flex-col p-4">
                    <div className="flex items-center justify-between mb-4 px-2">
                       <div className="flex flex-col">
                          <h3 className="font-display font-bold text-navy text-sm">Citizen Complaint Heatmap</h3>
                          <p className="text-[10px] font-bold text-gray-400 uppercase">Interactive spatial density map</p>
                       </div>
                       <div className="flex gap-4">
                          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500"></div><span className="text-[10px] font-bold text-gray-500 uppercase">Critical</span></div>
                          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-orange-500"></div><span className="text-[10px] font-bold text-gray-500 uppercase">High</span></div>
                          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-500"></div><span className="text-[10px] font-bold text-gray-500 uppercase">Normal</span></div>
                       </div>
                    </div>
                    <div className="flex-1 rounded-2xl overflow-hidden border border-gray-100 relative z-10">
                      <MapContainer center={[28.6139, 77.2090] as any} zoom={13} style={{ height: '100%', width: '100%' }}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        {complaints.map(c => (
                          <CircleMarker 
                            key={c.id} 
                            center={[c.lat, c.lng]} 
                            radius={8}
                            pathOptions={{ 
                              color: c.priority === 'Critical' ? '#ef4444' : c.priority === 'High' ? '#f59e0b' : '#3b82f6',
                              fillColor: c.priority === 'Critical' ? '#ef4444' : c.priority === 'High' ? '#f59e0b' : '#3b82f6',
                              fillOpacity: 0.6
                            }}
                          >
                            <Popup>
                              <div className="p-1">
                                <div className="font-bold text-xs mb-1 font-mono">{c.id}</div>
                                <div className="text-[10px] bg-gray-50 p-2 rounded-lg leading-relaxed">{c.description}</div>
                                <div className="mt-2 text-[10px] font-bold uppercase text-navy flex justify-between">
                                  <span>{c.category}</span>
                                  <span>{c.priority}</span>
                                </div>
                              </div>
                            </Popup>
                          </CircleMarker>
                        ))}
                      </MapContainer>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {view === 'public_feed' && (
              <motion.div 
                key="public_feed"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex-1 overflow-y-auto"
              >
                <div className="max-w-4xl mx-auto space-y-8">
                  <div className="text-center py-8">
                    <h2 className="text-3xl font-display font-black text-navy dark:text-white mb-2">Live Transparency Feed</h2>
                    <p className="text-gray-400">Real-time log of community resolutions and civic progress.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white dark:bg-[#111827] p-6 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-sm">
                      <div className="text-[10px] font-black text-gray-400 uppercase mb-2">Resolved This Week</div>
                      <div className="text-4xl font-display font-bold text-green-500">{stats.resolved + 12}</div>
                    </div>
                    <div className="bg-white dark:bg-[#111827] p-6 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-sm">
                      <div className="text-[10px] font-black text-gray-400 uppercase mb-2">Avg. Resolution Speed</div>
                      <div className="text-4xl font-display font-bold text-blue-500">22.4h</div>
                    </div>
                    <div className="bg-white dark:bg-[#111827] p-6 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-sm">
                      <div className="text-[10px] font-black text-gray-400 uppercase mb-2">Public Trust Score</div>
                      <div className="text-4xl font-display font-bold text-saffron">98.2%</div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {complaints.filter(c => c.status === 'Resolved' || c.status === 'In Progress').map(c => (
                      <div key={c.id} className="bg-white dark:bg-[#111827] p-6 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-md flex gap-6 items-start">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${c.status === 'Resolved' ? 'bg-green-50 text-green-500' : 'bg-blue-50 text-blue-500'}`}>
                          {c.status === 'Resolved' ? <CheckCircle2 size={24} /> : <Clock size={24} />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{c.category} • {c.id}</span>
                            <span className="text-[10px] font-bold text-navy bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded-full">{c.date}</span>
                          </div>
                          <h4 className="font-bold text-navy dark:text-white mb-2">{c.description}</h4>
                          <div className="flex items-center gap-4">
                             <div className="flex items-center gap-1.5"><StatusBadge status={c.status} /></div>
                             <div className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1"><MapPin size={10} /> Delhi, Ward {Math.floor(Math.random() * 50) + 1}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'track' && (
              <motion.div 
                key="track"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto w-full gap-8"
              >
                <div className="text-center">
                  <h2 className="font-display font-bold text-3xl">{lang === 'en' ? 'Track Your Complaint' : 'शिकायत ट्रैक करें'}</h2>
                  <p className="text-gray-400 mt-2">{lang === 'en' ? 'Enter your ID for live status updates' : 'लाइव अपडेट के लिए अपनी ID दर्ज करें'}</p>
                </div>

                <div className="w-full relative flex gap-3">
                  <input 
                    type="text"
                    value={trackId}
                    onChange={(e) => setTrackId(e.target.value.toUpperCase())}
                    placeholder="e.g. CIV-20240501-001"
                    className="flex-1 h-14 rounded-2xl border-2 border-gray-100 px-6 font-mono font-bold focus:ring-0 focus:border-navy transition-all"
                  />
                  <button className="px-8 h-14 bg-navy text-white rounded-2xl font-bold flex items-center gap-2 hover:bg-saffron transition-all shadow-lg active:scale-95">
                    <Search size={20} /> {lang === 'en' ? 'Search' : 'खोजें'}
                  </button>
                </div>

                <div className="w-full grid grid-cols-2 gap-4">
                   {complaints.filter(c => c.id === trackId).map(c => (
                     <React.Fragment key={c.id}>
                        <div className="col-span-2 p-6 bg-white rounded-3xl border border-gray-100 shadow-sm flex flex-col gap-6">
                           <div className="flex justify-between items-start">
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">Complaint Progress</span>
                                <h3 className="font-display font-bold text-xl">{c.category}</h3>
                              </div>
                              <StatusBadge status={c.status} />
                           </div>

                           <div className="relative pl-8 flex flex-col gap-8">
                             <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-gray-100"></div>
                             
                             <TimelineStep done={true} label="Submitted" date={c.date} desc="Issue was successfully logged." />
                             <TimelineStep done={true} label="Under Review" date="Active" desc={`Assigned to ${c.officer}`} />
                             <TimelineStep done={c.status !== 'Pending'} current={c.status === 'In Progress'} label="In Resolution" date="In Progress" desc="Government official is visiting the site." />
                             <TimelineStep done={c.status === 'Resolved'} label="Completed" date="Expected soon" desc="Issue has been fully fixed." />
                           </div>
                        </div>
                     </React.Fragment>
                   ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Right Sidebar - Info/Recent */}
        <aside className="w-[300px] bg-white border-l border-gray-100 flex flex-col p-6 shrink-0 gap-8">
           <div className="flex flex-col gap-3">
             <div className="flex items-center gap-2 mb-1">
               <div className="w-2 h-2 rounded-full bg-saffron tracking-tight"></div>
               <h3 className="font-bold text-sm uppercase">{lang === 'en' ? 'Quick Stats' : 'त्वरित आँकड़े'}</h3>
             </div>
             <MiniStat color="navy" label="Total Applications" value={stats.total} icon={<History size={16}/>} />
             <MiniStat color="saffron" label="Awaiting Action" value={stats.pending} icon={<Clock size={16}/>} />
             <MiniStat color="green" label="Resolved Cases" value={stats.resolved} icon={<CheckCircle2 size={16}/>} />
           </div>

           <div className="flex flex-col gap-4 overflow-hidden">
             <div className="flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-saffron"></div>
               <h3 className="font-bold text-sm uppercase">{lang === 'en' ? 'Recent History' : 'हाल का इतिहास'}</h3>
             </div>
             <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-3">
               {complaints.slice(0, 5).map(c => (
                 <div 
                   key={c.id} 
                   onClick={() => setSelectedComplaint(c)}
                   className="p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-saffron transition-all cursor-pointer group"
                 >
                   <div className="flex justify-between items-center mb-1">
                     <span className="font-mono text-[10px] font-bold text-navy">{c.id}</span>
                     <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${c.status === 'Resolved' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                       {c.status}
                     </span>
                   </div>
                   <p className="text-[11px] text-gray-500 font-medium truncate group-hover:text-navy transition-colors">{c.description}</p>
                   <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200">
                     <span className="text-[9px] text-gray-400 flex items-center gap-1 font-bold"><MapPin size={10} /> {c.category}</span>
                     <span className="text-[9px] text-gray-400 font-bold italic">{c.date}</span>
                   </div>
                 </div>
               ))}
             </div>
           </div>
        </aside>
      </div>

      {/* Modal - Complaint Details */}
      <AnimatePresence>
        {selectedComplaint && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-navy/60 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-[32px] w-full max-w-xl shadow-2xl overflow-hidden"
            >
              <div className="p-8 bg-navy text-white flex justify-between items-center">
                <div>
                  <h3 className="font-display font-bold text-2xl">Complaint Profile</h3>
                  <p className="text-white/60 text-sm mt-1">Reference ID: {selectedComplaint.id}</p>
                </div>
                <button 
                  onClick={() => setSelectedComplaint(null)}
                  className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-all font-bold"
                >✕</button>
              </div>
              
              <div className="p-8 space-y-8">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <DetailField label="Current Status" value={<StatusBadge status={selectedComplaint.status} />} />
                  <DetailField label="Date Filed" value={selectedComplaint.date} />
                  <DetailField label="Category" value={selectedComplaint.category} />
                  <DetailField label="Assigned Officer" value={selectedComplaint.officer} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <DetailField label="AI Priority Score" value={<PriorityBadge priority={selectedComplaint.priority} />} />
                   <DetailField label="User Sentiment" value={<span className="text-sm font-bold capitalize">{selectedComplaint.sentiment || 'Neutral'}</span>} />
                </div>
                
                <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-2">Detailed Issue Description</span>
                  <p className="text-sm text-gray-800 leading-relaxed italic">{selectedComplaint.description}</p>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-black text-navy uppercase tracking-widest flex items-center gap-2">
                    <Stars size={14} className="text-saffron" />
                    AI Suggested Responses
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    {suggestedResponses.length > 0 ? suggestedResponses.map((tpl, i) => (
                      <button 
                        key={i}
                        onClick={() => showToast("Template copied to clipboard!")}
                        className="p-3 text-left bg-white border border-gray-100 rounded-xl text-xs text-navy hover:border-saffron hover:bg-saffron/5 transition-all shadow-sm group relative"
                      >
                        <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Download size={12} className="text-saffron" />
                        </div>
                        {tpl}
                      </button>
                    )) : (
                      <div className="flex gap-2 p-3 bg-gray-50 rounded-xl">
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-pulse"></div>
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-pulse delay-75"></div>
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-pulse delay-150"></div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-4 pt-4 border-t border-gray-100">
                  <button 
                    onClick={() => updateComplaintStatus(selectedComplaint.id, selectedComplaint.status === 'Pending' ? 'In Progress' : 'Resolved')}
                    className="flex-1 h-12 bg-navy text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-saffron transition-all shadow-lg active:scale-95"
                  >
                    Update Progress <ArrowRight size={18} />
                  </button>
                  <button 
                    onClick={() => setSelectedComplaint(null)}
                    className="px-8 h-12 bg-gray-100 text-gray-600 rounded-2xl font-bold border border-gray-200 hover:bg-white hover:border-navy transition-all"
                  >Close</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showFeedbackModal && (
          <ResolutionFeedbackModal 
            complaint={showFeedbackModal} 
            onClose={() => setShowFeedbackModal(null)} 
            onSubmit={(rating: number, feedback: string) => {
              setComplaints(prev => prev.map(c => c.id === showFeedbackModal.id ? { ...c, rating, feedback } : c));
              showToast("Feedback submitted!");
              setShowFeedbackModal(null);
            }}
          />
        )}
        {showOnboarding && <OnboardingTour onComplete={() => setShowOnboarding(false)} />}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 bg-navy text-white rounded-2xl shadow-xl flex items-center gap-3 border border-white/10"
          >
            <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-xs">✓</div>
            <span className="font-bold text-sm">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Helper Components
function SidebarItem({ icon, label, active, badge, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-3 px-5 py-3 mx-2 rounded-xl transition-all ${
        active 
          ? 'bg-navy text-white shadow-md' 
          : 'text-gray-500 hover:bg-gray-100 hover:text-navy'
      }`}
    >
      <span className={active ? 'text-saffron' : 'text-gray-400'}>{icon}</span>
      <span className="text-[13px] font-bold flex-1 text-left">{label}</span>
      {badge ? <span className="bg-saffron text-white text-[10px] font-black px-2 py-0.5 rounded-full">{badge}</span> : null}
    </button>
  );
}

function StatCard({ label, value, icon, color }: any) {
  const colors: any = {
    navy: 'bg-navy-light/10 text-navy',
    orange: 'bg-orange-50 text-orange-600',
    saffron: 'bg-saffron-pale text-saffron',
    green: 'bg-green-50 text-green-600'
  };
  return (
    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-1 hover:shadow-md transition-all">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2 ${colors[color]}`}>{icon}</div>
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
      <span className="text-3xl font-display font-bold leading-tight">{value}</span>
    </div>
  );
}

function MiniStat({ color, label, value, icon }: any) {
  const colors: any = {
    navy: 'bg-navy text-white',
    saffron: 'bg-saffron text-white',
    green: 'bg-green-600 text-white'
  };
  return (
    <div className="flex items-center justify-between bg-gray-50 p-2.5 rounded-2xl border border-gray-100">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${colors[color]}`}>{icon}</div>
        <span className="text-[11px] font-bold text-gray-500">{label}</span>
      </div>
      <span className="text-lg font-display font-bold text-navy">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: Complaint['status'] }) {
  const configs: any = {
    'Pending': { 
      classes: 'bg-orange-50 text-orange-700 border-orange-100', 
      dot: 'bg-orange-500' 
    },
    'In Progress': { 
      classes: 'bg-blue-50 text-blue-700 border-blue-100', 
      dot: 'bg-blue-500' 
    },
    'Resolved': { 
      classes: 'bg-green-50 text-green-700 border-green-100', 
      dot: 'bg-green-500' 
    },
    'Emergency': { 
      classes: 'bg-red-50 text-red-700 border-red-100', 
      dot: 'bg-red-500' 
    },
  };
  
  const config = configs[status] || configs['Pending'];

  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border tracking-tight ${config.classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${status === 'In Progress' ? 'animate-pulse' : ''} ${status === 'Emergency' ? 'animate-bounce' : ''}`}></span>
      {status}
    </span>
  );
}

function DetailField({ label, value }: any) {
  return (
    <div className="p-4 bg-gray-50 rounded-xl flex flex-col gap-1">
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</span>
      <div className="text-sm font-bold text-navy">{value}</div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: Complaint['priority'] }) {
  const colors: any = {
    'Low': 'bg-gray-100 text-gray-600',
    'Medium': 'bg-blue-50 text-blue-600',
    'High': 'bg-orange-50 text-orange-600',
    'Critical': 'bg-red-50 text-red-600',
  };
  return (
    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-md w-fit uppercase ${colors[priority || 'Low']}`}>
      {priority || 'Low'}
    </span>
  );
}

function SLATimer({ deadline, status }: { deadline: number, status: string }) {
  const [timeLeft, setTimeLeft] = useState(deadline - Date.now());

  useEffect(() => {
    if (status === 'Resolved') return;
    const interval = setInterval(() => {
      setTimeLeft(deadline - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [deadline, status]);

  if (status === 'Resolved') return <span className="text-[10px] font-bold text-green-500 uppercase">RESOLVED</span>;

  const isOverdue = timeLeft < 0;
  const absTime = Math.abs(timeLeft);
  const hours = Math.floor(absTime / 3600000);
  const minutes = Math.floor((absTime % 3600000) / 60000);
  const seconds = Math.floor((absTime % 60000) / 1000);

  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-mono text-[11px] font-bold border transition-colors ${
      isOverdue ? 'bg-red-50 text-red-600 border-red-200' : 'bg-gray-50 text-gray-500 border-gray-100'
    }`}>
      <Clock size={12} />
      <span>{isOverdue ? '-' : ''}{String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}</span>
    </div>
  );
}

function TimelineStep({ done, current, label, date, desc }: any) {
  return (
    <div className="relative">
      <div className={`absolute -left-[30px] top-1 w-4 h-4 rounded-full border-4 border-white shadow-md z-10 transition-all ${
        done ? 'bg-navy dark:bg-green-500 scale-110' : current ? 'bg-saffron animate-pulse scale-125' : 'bg-gray-200 dark:bg-gray-700'
      }`}></div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
           <span className={`text-sm font-bold ${done ? 'text-navy dark:text-white' : current ? 'text-saffron' : 'text-gray-300'}`}>{label}</span>
           <span className="text-[10px] font-bold uppercase text-gray-400">{date}</span>
        </div>
        <p className={`text-xs ${done ? 'text-gray-600 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`}>{desc}</p>
      </div>
    </div>
  );
}

function ResolutionFeedbackModal({ complaint, onClose, onSubmit }: any) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [feedback, setFeedback] = useState('');

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-navy/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-gray-900 rounded-[32px] w-full max-w-sm p-8 shadow-2xl relative"
      >
        <div className="text-center">
          <div className="w-20 h-20 bg-green-50 dark:bg-green-900/20 text-green-500 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} />
          </div>
          <h3 className="font-display font-bold text-2xl text-navy dark:text-white">Resolution Feedback</h3>
          <p className="text-gray-400 text-sm mt-2">How was your experience for <span className="font-mono text-navy dark:text-saffron font-bold">{complaint.id}</span>?</p>
        </div>

        <div className="flex justify-center gap-2 my-8">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(star)}
              className="text-3xl transition-transform hover:scale-125"
            >
              <Star 
                size={32} 
                className={`${(hover || rating) >= star ? 'fill-saffron text-saffron' : 'text-gray-200'} transition-colors`} 
              />
            </button>
          ))}
        </div>

        <textarea 
          placeholder="Detailed feedback..."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4 text-xs h-24 focus:ring-2 focus:ring-navy outline-none resize-none mb-6 dark:text-white"
        ></textarea>

        <button 
          onClick={() => onSubmit(rating, feedback)}
          className="w-full h-12 bg-navy dark:bg-saffron text-white rounded-2xl font-bold hover:bg-saffron transition-all"
        >
          Submit Feedback
        </button>
      </motion.div>
    </div>
  );
}

function OnboardingTour({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    { title: "AI Assistant", desc: "Report issues via chat or voice. I'll automatically categorize and analyze them.", icon: <MessageSquare /> },
    { title: "Dark Mode", desc: "Switch to dark mode in the top right for a more comfortable view at night.", icon: <Moon /> },
    { title: "Real-time Tracking", desc: "Watch live as officials update your complaint status in the dashboard.", icon: <Activity /> }
  ];

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-navy/90 backdrop-blur-sm">
      <motion.div 
        key={step}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="bg-white dark:bg-gray-900 rounded-[32px] w-full max-w-sm p-8 shadow-2xl overflow-hidden relative"
      >
        <div className="flex justify-between items-center mb-8">
          <div className="flex gap-1">
            {steps.map((_, i) => (i <= step ? <div key={i} className="h-1 w-8 bg-navy dark:bg-saffron rounded-full"></div> : <div key={i} className="h-1 w-2 bg-gray-100 dark:bg-gray-800 rounded-full"></div>))}
          </div>
          <button onClick={onComplete} className="text-gray-300 hover:text-navy dark:hover:text-white transition-colors">✕</button>
        </div>

        <div className="mb-8">
          <div className="w-12 h-12 bg-gray-50 dark:bg-gray-800 rounded-2xl flex items-center justify-center text-navy dark:text-saffron mb-4">
            {steps[step].icon}
          </div>
          <h3 className="font-display font-bold text-2xl text-navy dark:text-white">{steps[step].title}</h3>
          <p className="text-gray-400 mt-2 leading-relaxed">{steps[step].desc}</p>
        </div>

        <button 
          onClick={() => step < steps.length - 1 ? setStep(step + 1) : onComplete()}
          className="w-full h-12 bg-navy dark:bg-saffron text-white rounded-2xl font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2"
        >
          {step < steps.length - 1 ? "Next" : "Get Started"} <ChevronRight size={18} />
        </button>
      </motion.div>
    </div>
  );
}
