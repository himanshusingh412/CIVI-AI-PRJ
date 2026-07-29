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
  Mail,
  ShieldCheck,
  Award,
  Stars,
  Activity,
  X,
  Phone,
  Locate,
  Briefcase,
  Sparkles,
  Gauge
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
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Complaint, ViewType, LangType, ChatMessage, SystemNotification } from './types';
import {
  requestOtp,
  verifyOtp,
  googleSignIn,
  logout,
  validateSession,
  setToken,
  validateIdentifier,
  formatMobile,
  type AuthError,
  type Channel,
} from './services/authService';
import { sendChat, getBrowserLocation, type ChatTurn } from './services/chatService';

type LivePin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  confidence: 'exact' | 'approximate' | 'city';
  category: string;
  priority: string;
};
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
  const [loginStep, setLoginStep] = useState<'identify' | 'otp'>('identify');
  const [channel, setChannel] = useState<Channel>('phone');
  const [identifier, setIdentifier] = useState('');
  const [otpValue, setOtpValue] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [lockedFor, setLockedFor] = useState(0);
  const [maskedIdentifier, setMaskedIdentifier] = useState('');
  const [rtiMode, setRtiMode] = useState(false);
  const [trackSearched, setTrackSearched] = useState(false);
  const [selectedOfficer, setSelectedOfficer] = useState<{ name: string; ward: string; count: number; solved: number; pending: number; rating: number } | null>(null);
  const [mapFlyTarget, setMapFlyTarget] = useState<{ lat: number; lng: number } | null>(null);
  // AI chat + live map
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [livePins, setLivePins] = useState<LivePin[]>([]);
  const [activePin, setActivePin] = useState<LivePin | null>(null);
  const [showLiveMap, setShowLiveMap] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [aiProvider, setAiProvider] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const GOOGLE_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';

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

  // Restore an existing session on load
  useEffect(() => {
    validateSession().then(valid => { if (valid) setIsAuthenticated(true); });
  }, []);

  // Ask for GPS once the citizen is signed in — improves map accuracy
  useEffect(() => {
    if (!isAuthenticated) return;
    getBrowserLocation().then(coords => { if (coords) setUserCoords(coords); });
  }, [isAuthenticated]);

  // Resend-OTP cooldown ticker
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  // Lockout ticker
  useEffect(() => {
    if (lockedFor <= 0) return;
    const t = setInterval(() => setLockedFor(s => {
      const next = Math.max(0, s - 1);
      if (next === 0) setAuthError(null);
      return next;
    }), 1000);
    return () => clearInterval(t);
  }, [lockedFor]);

  const handleRequestOtp = async () => {
    setAuthError(null); setAuthInfo(null);

    const check = validateIdentifier(identifier, channel);
    if (!check.ok) { setAuthError(check.reason!); return; }

    setAuthBusy(true);
    const res = await requestOtp(identifier);
    setAuthBusy(false);

    if (!('ok' in res) || res.ok !== true) {
      const err = res as AuthError;
      setAuthError(err.message);
      if (err.retryAfterSec) {
        if (err.error === 'locked_out' || err.error === 'otp_limit') setLockedFor(err.retryAfterSec);
        else setResendIn(err.retryAfterSec);
      }
      return;
    }

    setMaskedIdentifier(res.maskedIdentifier);
    setLoginStep('otp');
    const code = res.devOtp || '123456';
    setOtpValue(code);
    setAttemptsLeft(null);
    setResendIn(30);
    setAuthInfo(
      res.devOtp
        ? `Demo Mode · Code auto-filled: ${res.devOtp}`
        : `A 6-digit code was sent by ${res.channel === 'email' ? 'email' : 'SMS'} to ${res.maskedIdentifier}`
    );
  };

  const handleVerifyOtp = async () => {
    setAuthError(null);
    if (!/^\d{6}$/.test(otpValue)) { setAuthError('Enter the 6-digit code.'); return; }

    setAuthBusy(true);
    const res = await verifyOtp(identifier, otpValue);
    setAuthBusy(false);

    if (!('ok' in res) || res.ok !== true) {
      const err = res as AuthError;
      setAuthError(err.message);
      if (typeof err.attemptsRemaining === 'number') setAttemptsLeft(err.attemptsRemaining);
      if (err.error === 'locked_out' && err.retryAfterSec) {
        setLockedFor(err.retryAfterSec);
        setLoginStep('identify');
        setAttemptsLeft(null);
      }
      if (err.error === 'expired') { setLoginStep('identify'); setAttemptsLeft(null); }
      setOtpValue('');
      return;
    }

    setToken(res.token);
    setIsAuthenticated(true);
    setAuthError(null); setAuthInfo(null); setAttemptsLeft(null);
    setOtpValue(''); setIdentifier('');
    showToast('Login successful!');
    setShowOnboarding(true);
  };

  const handleGoogleCredential = async (response: { credential?: string }) => {
    if (!response?.credential) return;
    setAuthError(null); setAuthInfo(null); setAuthBusy(true);
    const res = await googleSignIn(response.credential);
    setAuthBusy(false);

    if (!('ok' in res) || res.ok !== true) {
      const err = res as AuthError;
      setAuthError(err.message);
      return;
    }

    setToken(res.token);
    setIsAuthenticated(true);
    setAuthError(null); setAuthInfo(null); setAttemptsLeft(null);
    setOtpValue(''); setIdentifier('');
    showToast('Signed in with Google!');
    setShowOnboarding(true);
  };

  // Render the Google Identity Services button once the script is loaded — only while signing in.
  useEffect(() => {
    if (isAuthenticated || loginStep !== 'identify' || !GOOGLE_CLIENT_ID) return;

    let cancelled = false;
    const tryRender = () => {
      if (cancelled) return;
      const g = (window as any).google;
      if (!g?.accounts?.id || !googleBtnRef.current) {
        setTimeout(tryRender, 200);
        return;
      }
      g.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
      googleBtnRef.current.innerHTML = '';
      g.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline', size: 'large', width: 344, text: 'continue_with', shape: 'pill',
      });
    };
    tryRender();
    return () => { cancelled = true; };
  }, [isAuthenticated, loginStep, GOOGLE_CLIENT_ID]);

  const handleLogout = async () => {
    await logout();
    setIsAuthenticated(false);
    setLoginStep('identify');
    setIdentifier(''); setOtpValue('');
    setAuthError(null); setAuthInfo(null); setAttemptsLeft(null);
    showToast('Signed out securely.');
  };

  const markNotificationRead = (id: string) =>
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));

  const markAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    showToast('All notifications marked as read.');
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Template copied to clipboard!');
    } catch {
      // clipboard API blocked (http / older browsers) — fall back to execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast('Template copied to clipboard!');
      } catch {
        showToast('Copy failed — please select the text manually.');
      }
      document.body.removeChild(ta);
    }
  };

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
    if (text.length > 2000) {
      showToast('Message too long — please keep it under 2000 characters.');
      return;
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      content: text,
      type: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setChatHistory(prev => [...prev, { role: 'user', content: text }].slice(-12));
    processUserInput(text);
  };

  /** Routes a message to the AI backend and syncs the live map. */
  const runAiTurn = async (text: string) => {
    setIsTyping(true);
    const res = await sendChat(text, chatHistory, userCoords);
    setIsTyping(false);

    setChatHistory(prev => [...prev, { role: 'assistant', content: res.reply }].slice(-12));
    setAiProvider(res.provider ?? null);

    if (res.location) {
      const pin: LivePin = {
        id: `pin-${Date.now()}`,
        lat: res.location.lat,
        lng: res.location.lng,
        label: res.location.label,
        confidence: res.location.confidence,
        category: res.category,
        priority: res.priority,
      };
      setLivePins(prev => [...prev.slice(-9), pin]);
      setActivePin(pin);
      setShowLiveMap(true);
    }

    if (res.rateLimited) showToast('AI limit reached — using offline mode.');

    setMessages(prev => [...prev, {
      id: `${Date.now()}-bot`,
      content: res.reply,
      type: 'bot',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }]);

    // AI has everything it needs → prime the filing flow
    if (res.readyToFile && res.intent === 'report_complaint') {
      setPendingComplaint(prev => ({
        ...prev,
        description: text,
        category: res.category,
        priority: res.priority,
        sentiment: res.sentiment,
        ...(res.location ? { lat: res.location.lat, lng: res.location.lng } : {}),
      }));
      setAiSuggestedCategory(res.category);
      setChatStep('ask_photo');
      botReply('Would you like to attach a photo for faster resolution? (or say "skip")', 900);
    }
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
      
      // Nothing scripted matched → hand off to the AI assistant (Gemini/Claude)
      await runAiTurn(text);
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
      <div className="min-h-screen w-full bg-[#0F172A] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
        {/* Ambient depth — decorative only, hidden from assistive tech */}
        <div aria-hidden="true" className="aurora-bg opacity-40">
          <div className="aurora-blob absolute -top-[15%] -left-[10%] w-[45%] h-[45%] bg-[#0369A1]" />
          <div className="aurora-blob absolute -bottom-[15%] -right-[10%] w-[45%] h-[45%] bg-[#C2410C]" style={{ animationDelay: '5s' }} />
          <div className="aurora-blob absolute top-[40%] left-[60%] w-[30%] h-[30%] bg-[#7C3AED]" style={{ animationDelay: '9s' }} />
        </div>

        <TiltCard maxTilt={4} className="w-full max-w-md">
        <motion.main
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          className="bg-white rounded-2xl p-7 sm:p-9 w-full shadow-2xl relative z-10 border border-white/10 glow-navy"
        >
          <header className="text-center mb-7">
            <div aria-hidden="true" className="float-y w-14 h-14 bg-gradient-to-br from-navy via-navy-light to-cta rounded-xl flex items-center justify-center mx-auto mb-4 text-white shadow-lg">
              <ShieldCheck size={28} strokeWidth={2} />
            </div>
            <h1 className="font-display font-bold text-2xl text-[#0F172A] tracking-tight">
              Sign in to CivicAI
            </h1>
            <p className="text-[#475569] text-sm mt-1.5">
              {loginStep === 'identify'
                ? 'Sign in with your email or mobile number'
                : `Enter the code we sent by ${channel === 'email' ? 'email' : 'SMS'}`}
            </p>
          </header>

          {/* Step indicator */}
          <ol className="flex items-center gap-2 mb-6" aria-label="Sign-in progress">
            <li className="flex-1 flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ${
                loginStep === 'identify' ? 'bg-[#0369A1] text-white' : 'bg-[#15803D] text-white'
              }`}>
                {loginStep === 'identify' ? '1' : <CheckCircle2 size={13} strokeWidth={3} />}
              </span>
              <span className={`h-1 flex-1 rounded-full ${loginStep === 'otp' ? 'bg-[#15803D]' : 'bg-[#E2E8F0]'}`} />
            </li>
            <li className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold ${
                loginStep === 'otp' ? 'bg-[#0369A1] text-white' : 'bg-[#E2E8F0] text-[#475569]'
              }`}>2</span>
            </li>
          </ol>

          {/* Live region so screen readers announce errors and status */}
          <div aria-live="polite" aria-atomic="true">
            {authError && (
              <div role="alert" className="flex items-start gap-2.5 p-3.5 bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl mb-5">
                <AlertTriangle size={16} className="text-[#B91C1C] mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-[13px] font-semibold text-[#B91C1C]">
                  {authError}
                  {lockedFor > 0 && (
                    <span className="block mt-1 font-mono text-xs font-bold">
                      Unlocks in {Math.floor(lockedFor / 60)}:{String(lockedFor % 60).padStart(2, '0')}
                    </span>
                  )}
                </p>
              </div>
            )}
            {authInfo && !authError && (
              <div role="status" className="flex items-start gap-2.5 p-3.5 bg-[#F0FDF4] border border-[#86EFAC] rounded-xl mb-5">
                <CheckCircle2 size={16} className="text-[#15803D] mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-[13px] font-semibold text-[#15803D]">{authInfo}</p>
              </div>
            )}
          </div>

          {loginStep === 'identify' ? (
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); handleRequestOtp(); }}>
              {/* Channel toggle */}
              <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-2 gap-1 p-1 bg-[#F1F5F9] rounded-xl">
                {([
                  { key: 'phone' as Channel, label: 'Mobile', Icon: Smartphone },
                  { key: 'email' as Channel, label: 'Email', Icon: Mail },
                ]).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={channel === key}
                    disabled={authBusy || lockedFor > 0}
                    onClick={() => { setChannel(key); setIdentifier(''); setAuthError(null); setAuthInfo(null); }}
                    className={`h-10 rounded-lg text-[14px] font-semibold flex items-center justify-center gap-2 ${
                      channel === key
                        ? 'bg-white text-[#0F172A] shadow-sm'
                        : 'text-[#475569] hover:text-[#0F172A]'
                    }`}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>

              {channel === 'phone' ? (
                <div>
                  <label htmlFor="identifier" className="block text-[13px] font-semibold text-[#0F172A] mb-1.5">
                    Mobile number
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#475569] text-[15px] font-semibold pointer-events-none">
                      +91
                    </span>
                    <input
                      id="identifier"
                      name="identifier"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      maxLength={11}
                      required
                      autoFocus
                      aria-describedby="identifier-hint"
                      aria-invalid={!!authError}
                      disabled={authBusy || lockedFor > 0}
                      placeholder="98765 43210"
                      value={identifier}
                      onChange={(e) => { setIdentifier(formatMobile(e.target.value)); setAuthError(null); }}
                      className="w-full h-12 pl-14 pr-4 bg-white border-2 border-[#CBD5E1] rounded-xl outline-none text-base tracking-[0.06em] font-mono text-[#0F172A] placeholder:text-[#94A3B8] hover:border-[#94A3B8] focus:border-[#0369A1] disabled:bg-[#F1F5F9] disabled:opacity-60"
                    />
                  </div>
                  <p id="identifier-hint" className="text-xs text-[#475569] mt-1.5">
                    We'll text a 6-digit code to this number
                  </p>
                </div>
              ) : (
                <div>
                  <label htmlFor="identifier" className="block text-[13px] font-semibold text-[#0F172A] mb-1.5">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#475569]" size={18} aria-hidden="true" />
                    <input
                      id="identifier"
                      name="identifier"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      maxLength={254}
                      required
                      autoFocus
                      aria-describedby="identifier-hint"
                      aria-invalid={!!authError}
                      disabled={authBusy || lockedFor > 0}
                      placeholder="you@example.com"
                      value={identifier}
                      onChange={(e) => { setIdentifier(e.target.value); setAuthError(null); }}
                      className="w-full h-12 pl-11 pr-4 bg-white border-2 border-[#CBD5E1] rounded-xl outline-none text-base text-[#0F172A] placeholder:text-[#94A3B8] hover:border-[#94A3B8] focus:border-[#0369A1] disabled:bg-[#F1F5F9] disabled:opacity-60"
                    />
                  </div>
                  <p id="identifier-hint" className="text-xs text-[#475569] mt-1.5">
                    We'll email a 6-digit code to this address
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={authBusy || lockedFor > 0 || !validateIdentifier(identifier, channel).ok}
                className="btn-sheen w-full h-12 bg-gradient-to-r from-[#0369A1] to-[#0284C7] text-white rounded-xl font-semibold text-[15px] hover:shadow-lg hover:shadow-[#0369A1]/30 active:scale-[0.99] flex items-center justify-center gap-2 disabled:bg-[#94A3B8] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {authBusy ? (
                  <>
                    <span aria-hidden="true" className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending code…
                  </>
                ) : lockedFor > 0 ? 'Temporarily locked' : (
                  <>Send code <ChevronRight size={18} aria-hidden="true" /></>
                )}
              </button>

              <p className="text-xs text-[#475569] text-center">
                Limits: 5 codes per 15 minutes · 9 verification attempts
              </p>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); handleVerifyOtp(); }}>
              <div>
                <label htmlFor="otp" className="block text-[13px] font-semibold text-[#0F172A] mb-1.5">
                  6-digit code
                </label>
                <div className="relative">
                  {channel === 'email'
                    ? <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#475569]" size={18} aria-hidden="true" />
                    : <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#475569]" size={18} aria-hidden="true" />}
                  <input
                    id="otp"
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    autoFocus
                    aria-describedby="otp-hint"
                    aria-invalid={!!authError}
                    disabled={authBusy}
                    placeholder="000000"
                    value={otpValue}
                    onChange={(e) => { setOtpValue(e.target.value.replace(/\D/g, '').slice(0, 6)); setAuthError(null); }}
                    className="w-full h-14 pl-11 pr-4 bg-white border-2 border-[#CBD5E1] rounded-xl outline-none text-2xl tracking-[0.5em] font-bold font-mono text-center text-[#0F172A] placeholder:text-[#CBD5E1] hover:border-[#94A3B8] focus:border-[#0369A1] disabled:bg-[#F1F5F9] disabled:opacity-60"
                  />
                </div>
                <p id="otp-hint" className="text-xs text-[#475569] mt-1.5 text-center">
                  Sent to <span className="font-mono font-semibold text-[#0F172A]">{maskedIdentifier}</span> · valid 5 minutes
                </p>
              </div>

              {attemptsLeft !== null && attemptsLeft > 0 && (
                <div className="flex flex-col items-center gap-2" role="status">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <span
                        key={i}
                        aria-hidden="true"
                        className={`h-1.5 w-4 rounded-full ${i < attemptsLeft ? 'bg-[#15803D]' : 'bg-[#FCA5A5]'}`}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-semibold text-[#475569]">
                    {attemptsLeft} of 9 attempts left
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={authBusy || otpValue.length !== 6}
                className="btn-sheen w-full h-12 bg-gradient-to-r from-[#0369A1] to-[#0284C7] text-white rounded-xl font-semibold text-[15px] hover:shadow-lg hover:shadow-[#0369A1]/30 active:scale-[0.99] flex items-center justify-center gap-2 disabled:bg-[#94A3B8] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {authBusy ? (
                  <>
                    <span aria-hidden="true" className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Verifying…
                  </>
                ) : (
                  <>Verify and continue <ChevronRight size={18} aria-hidden="true" /></>
                )}
              </button>

              <div className="flex items-center justify-center gap-4 pt-1">
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={authBusy || resendIn > 0}
                  className="text-[13px] font-semibold text-[#0369A1] hover:text-[#075985] hover:underline disabled:text-[#94A3B8] disabled:no-underline disabled:cursor-not-allowed"
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                </button>
                <span aria-hidden="true" className="text-[#CBD5E1]">|</span>
                <button
                  type="button"
                  onClick={() => { setLoginStep('identify'); setOtpValue(''); setAuthError(null); setAuthInfo(null); setAttemptsLeft(null); }}
                  className="text-[13px] font-semibold text-[#475569] hover:text-[#0F172A] hover:underline"
                >
                  {channel === 'email' ? 'Change email' : 'Change number'}
                </button>
              </div>
            </form>
          )}

          {loginStep === 'identify' && GOOGLE_CLIENT_ID && (
            <>
              <div className="flex items-center gap-3 my-5" aria-hidden="true">
                <span className="h-px flex-1 bg-[#E2E8F0]" />
                <span className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-widest">or</span>
                <span className="h-px flex-1 bg-[#E2E8F0]" />
              </div>
              <div ref={googleBtnRef} className="flex justify-center [&>div]:!w-full" />
            </>
          )}

          <footer className="flex items-center gap-2 justify-center mt-7 pt-5 border-t border-[#E2E8F0]">
            <ShieldCheck size={14} className="text-[#15803D]" aria-hidden="true" />
            <span className="text-xs font-semibold text-[#475569]">
              Government-verified · Codes are hashed, never stored in plain text
            </span>
          </footer>
        </motion.main>
        </TiltCard>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-screen overflow-hidden bg-gray-50 text-navy transition-colors duration-300 dark:bg-[#0a0f1d] dark:text-[#f8f9fc]">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* Ambient premium depth — dark mode only, decorative */}
      {isDarkMode && (
        <div aria-hidden="true" className="aurora-bg fixed inset-0 z-0">
          <div className="aurora-blob w-[32rem] h-[32rem] bg-[#0369A1] -top-40 -left-40" />
          <div className="aurora-blob w-[28rem] h-[28rem] bg-[#C2410C] top-1/3 -right-40" style={{ animationDelay: '4s' }} />
          <div className="aurora-blob w-[26rem] h-[26rem] bg-[#7C3AED] bottom-0 left-1/4" style={{ animationDelay: '8s' }} />
        </div>
      )}

      {/* Top Navigation */}
      <nav className="h-20 glass border-b border-gray-100 dark:border-white/5 px-8 flex items-center justify-between shrink-0 relative z-[100]">
        <div className="flex items-center gap-4">
          <div className="float-y w-11 h-11 bg-gradient-to-br from-navy via-navy-light to-cta dark:from-cta dark:via-sky-500 dark:to-saffron rounded-xl flex items-center justify-center text-white shadow-lg shadow-navy/30 dark:glow-navy relative" style={{ transformStyle: 'preserve-3d' }}>
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight text-gradient-premium">CivicAI</h1>
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
                    className="absolute right-0 mt-2 w-80 glass-strong rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden z-[100]"
                  >
                    <div className="p-4 border-b border-gray-50 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                      <span className="text-[10px] font-black uppercase tracking-widest text-navy dark:text-gray-300">Notifications</span>
                      <button
                        onClick={markAllNotificationsRead}
                        disabled={!notifications.some(n => !n.read)}
                        className="text-[10px] font-bold text-saffron uppercase hover:underline disabled:opacity-40 disabled:no-underline"
                      >
                        Mark all read
                      </button>
                    </div>
                    <div className="max-h-[300px] overflow-auto">
                      {notifications.length === 0 ? (
                        <p className="p-6 text-center text-[11px] text-gray-400 font-semibold">No notifications</p>
                      ) : notifications.map(n => (
                        <div
                          key={n.id}
                          onClick={() => markNotificationRead(n.id)}
                          className={`p-4 border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all cursor-pointer ${!n.read ? 'bg-saffron/5' : ''}`}
                        >
                          <h4 className="text-xs font-bold text-navy dark:text-white flex items-center gap-2">
                            {!n.read && <span className="w-1.5 h-1.5 bg-saffron rounded-full shrink-0" />}
                            {n.title}
                          </h4>
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
            <button onClick={handleLogout} title="Sign out" className="w-10 h-10 rounded-xl text-gray-300 hover:text-red-500 transition-all">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden relative z-10">
        {/* Sidebar */}
        <aside className="w-[240px] glass border-r border-gray-100 dark:border-white/5 flex flex-col py-6 shrink-0">
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
              className="btn-sheen w-full py-2.5 bg-gradient-to-br from-red-500 to-red-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-red-500/30 dark:shadow-red-900/40 hover:-translate-y-0.5 transition-all active:scale-95"
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
                  <div className="flex-1">
                    <h2 className="font-display font-bold text-lg">{lang === 'en' ? 'CivicAI Assistant' : 'CivicAI सहायक'}</h2>
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                      {lang === 'en' ? 'Online • Govt. Verified System' : 'ऑनलाइन • सरकारी प्रणाली'}
                      {aiProvider && (
                        <span className="ml-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[9px] font-bold uppercase tracking-wide">
                          {aiProvider === 'fallback' ? 'offline mode' : aiProvider}
                        </span>
                      )}
                    </div>
                  </div>

                  {livePins.length > 0 && (
                    <button
                      onClick={() => setShowLiveMap(v => !v)}
                      className={`h-10 px-4 rounded-xl text-xs font-bold flex items-center gap-2 border transition-all ${
                        showLiveMap
                          ? 'bg-navy text-white border-navy'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:text-navy hover:border-navy'
                      }`}
                    >
                      <MapPin size={14} />
                      {showLiveMap ? 'Hide Map' : `Live Map (${livePins.length})`}
                    </button>
                  )}
                </div>

                {/* ─── LIVE MAP: pins drop as the AI extracts locations ─── */}
                <AnimatePresence>
                  {showLiveMap && livePins.length > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 260, opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className={`rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 relative shrink-0 shadow-lg map-premium ${isDarkMode ? 'map-dark' : ''}`}
                    >
                      <MapContainer
                        key={activePin?.id || 'live-map'}
                        center={[activePin?.lat ?? 28.6139, activePin?.lng ?? 77.2090]}
                        zoom={activePin?.confidence === 'exact' ? 15 : 12}
                        style={{ height: '260px', width: '100%' }}
                        scrollWheelZoom={false}
                      >
                        <TileLayer
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          attribution="&copy; OpenStreetMap"
                        />
                        <MapController target={mapFlyTarget} zoom={16} />
                        {livePins.map((p, i) => (
                          <CircleMarker
                            key={p.id}
                            center={[p.lat, p.lng]}
                            radius={i === livePins.length - 1 ? 13 : 8}
                            pathOptions={{
                              color:
                                p.priority === 'Critical' ? '#dc2626' :
                                p.priority === 'High' ? '#f97316' :
                                p.priority === 'Medium' ? '#eab308' : '#22c55e',
                              fillOpacity: i === livePins.length - 1 ? 0.75 : 0.35,
                              weight: i === livePins.length - 1 ? 3 : 1.5,
                            }}
                            eventHandlers={{ click: () => setActivePin(p) }}
                          >
                            <Popup>
                              <div className="text-xs">
                                <strong>{p.category}</strong><br />
                                {p.label}<br />
                                <span className="text-gray-500">
                                  Priority: {p.priority} · {p.confidence}
                                </span>
                              </div>
                            </Popup>
                          </CircleMarker>
                        ))}
                        {userCoords && (
                          <CircleMarker
                            center={[userCoords.lat, userCoords.lng]}
                            radius={7}
                            pathOptions={{ color: '#2563eb', fillOpacity: 0.9, weight: 2 }}
                          >
                            <Popup><span className="text-xs">You are here</span></Popup>
                          </CircleMarker>
                        )}
                      </MapContainer>

                      <button
                        onClick={async () => {
                          const coords = await getBrowserLocation();
                          if (coords) { setUserCoords(coords); setMapFlyTarget(coords); showToast('Centered on your location'); }
                          else showToast('Could not access your location');
                        }}
                        title="Locate me"
                        className="absolute top-3 right-3 z-[500] w-9 h-9 rounded-xl bg-white/95 dark:bg-gray-900/95 backdrop-blur border border-gray-100 dark:border-gray-800 shadow-lg flex items-center justify-center text-navy dark:text-white hover:text-cta hover:-translate-y-0.5 transition-all"
                      >
                        <Locate size={16} />
                      </button>

                      {activePin && (
                        <div className="absolute bottom-3 left-3 right-3 bg-white/95 dark:bg-gray-900/95 backdrop-blur px-4 py-2.5 rounded-xl border border-gray-100 dark:border-gray-800 shadow-lg z-[500] flex items-center gap-3">
                          <MapPin size={15} className="text-saffron shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold text-navy dark:text-white truncate">{activePin.label}</p>
                            <p className="text-[10px] text-gray-400">
                              {activePin.category} · {activePin.priority} · {activePin.confidence} location
                            </p>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

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
                      <div className="bg-white dark:bg-gray-800 p-3 pr-6 rounded-2xl flex gap-1 shadow-sm">
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
                            className="px-4 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 dark:text-gray-200 rounded-full text-xs font-semibold hover:border-saffron hover:text-saffron transition-all"
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
                            className="px-4 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 dark:text-gray-200 rounded-full text-xs font-semibold hover:border-saffron hover:text-saffron transition-all"
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
                          className="px-4 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 dark:text-gray-200 rounded-full text-xs font-semibold hover:border-saffron hover:text-saffron transition-all"
                        >
                          {label}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="glass-strong border-2 border-gray-100 dark:border-gray-800 rounded-2xl flex items-end p-2 focus-within:border-navy dark:focus-within:border-cta transition-all shadow-sm">
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
                      className="flex-1 border-none bg-transparent focus:ring-0 text-sm py-2 px-1 resize-none h-10 max-h-32 dark:text-white dark:placeholder-gray-500"
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
                      className="btn-sheen w-10 h-10 bg-gradient-to-br from-navy to-cta dark:from-cta dark:to-saffron text-white rounded-full flex items-center justify-center hover:shadow-lg hover:-translate-y-0.5 transition-all shrink-0"
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
                    <h2 className="font-display font-bold text-2xl dark:text-white">{lang === 'en' ? 'Officer Dashboard' : 'अधिकारी डैशबोर्ड'}</h2>
                    <p className="text-gray-400 text-sm mt-0.5">{lang === 'en' ? 'Track and manage citizen submissions' : 'प्रस्तुतियों को ट्रैक करें और प्रबंधित करें'}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex bg-white dark:bg-[#111827] rounded-xl border border-gray-100 dark:border-gray-800 p-1 shadow-sm">
                      <button
                        onClick={() => setDashboardTab('overview')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'overview' ? 'bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white shadow-sm' : 'text-gray-500 hover:text-navy dark:hover:text-white'}`}
                      >Overview</button>
                      <button
                        onClick={() => setDashboardTab('analytics')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'analytics' ? 'bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white shadow-sm' : 'text-gray-500 hover:text-navy dark:hover:text-white'}`}
                      >Analytics</button>
                      <button
                        onClick={() => setDashboardTab('workload')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'workload' ? 'bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white shadow-sm' : 'text-gray-500 hover:text-navy dark:hover:text-white'}`}
                      >Workload</button>
                      <button
                        onClick={() => setDashboardTab('heatmap')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'heatmap' ? 'bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white shadow-sm' : 'text-gray-500 hover:text-navy dark:hover:text-white'}`}
                      >Heatmap</button>
                    </div>
                    <button
                      onClick={exportToCSV}
                      className="btn-sheen px-4 h-10 bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700 rounded-xl text-navy dark:text-white flex items-center gap-2 text-xs font-bold hover:border-navy dark:hover:border-cta transition-all shadow-sm"
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

                    <div className="flex-1 bg-white dark:bg-[#111827] rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col">
                      <div className="px-6 py-4 bg-gray-50/50 dark:bg-white/5 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <h3 className="font-bold text-sm tracking-wide shrink-0 dark:text-white">COMPLAINT REGISTRY</h3>

                        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                          <div className="relative flex-1 sm:w-64">
                            <Search className="absolute left-3 top-2.5 text-gray-400" size={14} />
                            <input
                              type="text"
                              placeholder="Search complaints..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full h-9 pl-9 pr-4 bg-white dark:bg-gray-800 dark:text-white rounded-lg border border-gray-200 dark:border-gray-700 text-xs focus:ring-1 focus:ring-navy focus:border-navy dark:focus:ring-cta dark:focus:border-cta transition-all"
                            />
                          </div>
                          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                            {(['all', 'Pending', 'In Progress', 'Resolved'] as const).map(f => (
                              <button
                                key={f}
                                onClick={() => setDashboardFilter(f)}
                                className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${
                                  dashboardFilter === f ? 'bg-white dark:bg-gray-700 text-navy dark:text-white shadow-sm' : 'text-gray-400 hover:text-navy dark:hover:text-white'
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
                            <tr className="border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-[#111827] z-10">
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">ID</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">Category</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">Description</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">Status</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">SLA Timer</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                            {filteredComplaints.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-gray-400 text-sm">
                                  No complaints found matching your criteria.
                                </td>
                              </tr>
                            ) : (
                              filteredComplaints.map(c => (
                                <tr key={c.id} className="hover:bg-gray-50/50 dark:hover:bg-white/5 transition-colors">
                                  <td className="px-6 py-4 font-mono text-xs font-bold text-navy dark:text-white">{c.id}</td>
                                  <td className="px-6 py-4 text-xs font-medium dark:text-gray-300">
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
                                      className="btn-sheen px-3 py-1.5 bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white rounded-lg text-[10px] font-bold hover:shadow-md transition-all"
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
                      <div className="bg-white dark:bg-[#111827] p-6 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col gap-4">
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

                      <div className="bg-white dark:bg-[#111827] p-6 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col gap-4">
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

                    <div className="bg-white dark:bg-[#111827] p-6 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="font-display font-bold text-sm dark:text-white">Resolution Performance</h3>
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
                        <TiltCard key={off.name} maxTilt={5} className="bg-white dark:bg-[#111827] p-6 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col gap-6 hover:shadow-xl transition-shadow group">
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
                          
                          <button
                            onClick={() => setSelectedOfficer(off)}
                            className="w-full py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-bold text-navy dark:text-white hover:bg-navy hover:text-white hover:border-navy dark:hover:bg-cta dark:hover:border-cta transition-all"
                          >View Performance Report</button>
                        </TiltCard>
                      ))}
                    </div>
                  </div>
                )}

                {dashboardTab === 'heatmap' && (
                  <div className="flex-1 bg-white dark:bg-[#111827] rounded-3xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col p-4">
                    <div className="flex items-center justify-between mb-4 px-2">
                       <div className="flex flex-col">
                          <h3 className="font-display font-bold text-navy dark:text-white text-sm">Citizen Complaint Heatmap</h3>
                          <p className="text-[10px] font-bold text-gray-400 uppercase">Interactive spatial density map</p>
                       </div>
                       <div className="flex gap-4">
                          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500"></div><span className="text-[10px] font-bold text-gray-500 uppercase">Critical</span></div>
                          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-orange-500"></div><span className="text-[10px] font-bold text-gray-500 uppercase">High</span></div>
                          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-500"></div><span className="text-[10px] font-bold text-gray-500 uppercase">Normal</span></div>
                       </div>
                    </div>
                    <div className={`flex-1 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 relative z-10 shadow-inner map-premium ${isDarkMode ? 'map-dark' : ''}`}>
                      <MapContainer center={[28.6139, 77.2090] as any} zoom={13} style={{ height: '100%', width: '100%' }}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <MapController target={mapFlyTarget} zoom={15} />
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
                      <button
                        onClick={async () => {
                          const coords = await getBrowserLocation();
                          if (coords) { setUserCoords(coords); setMapFlyTarget(coords); showToast('Centered on your location'); }
                          else showToast('Could not access your location');
                        }}
                        title="Locate me"
                        className="absolute top-3 right-3 z-[500] w-9 h-9 rounded-xl bg-white/95 dark:bg-gray-900/95 backdrop-blur border border-gray-100 dark:border-gray-800 shadow-lg flex items-center justify-center text-navy dark:text-white hover:text-cta hover:-translate-y-0.5 transition-all"
                      >
                        <Locate size={16} />
                      </button>
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

                <form
                  className="w-full relative flex gap-3"
                  onSubmit={(e) => { e.preventDefault(); setTrackSearched(true); }}
                >
                  <input
                    type="text"
                    value={trackId}
                    onChange={(e) => { setTrackId(e.target.value.toUpperCase()); setTrackSearched(false); }}
                    placeholder="e.g. CIV-20240501-001"
                    className="flex-1 h-14 rounded-2xl border-2 border-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-white px-6 font-mono font-bold focus:ring-0 focus:border-navy dark:focus:border-cta transition-all"
                  />
                  <button
                    type="submit"
                    disabled={!trackId.trim()}
                    className="btn-sheen px-8 h-14 bg-gradient-to-br from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white rounded-2xl font-bold flex items-center gap-2 hover:-translate-y-0.5 transition-all shadow-lg active:scale-95 disabled:opacity-40 disabled:hover:translate-y-0"
                  >
                    <Search size={20} /> {lang === 'en' ? 'Search' : 'खोजें'}
                  </button>
                </form>

                <div className="w-full grid grid-cols-2 gap-4">
                   {complaints.filter(c => c.id === trackId).map(c => (
                     <React.Fragment key={c.id}>
                        <div className="col-span-2 p-6 bg-white dark:bg-[#111827] rounded-3xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col gap-6">
                           <div className="flex justify-between items-start">
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">Complaint Progress</span>
                                <h3 className="font-display font-bold text-xl dark:text-white">{c.category}</h3>
                              </div>
                              <StatusBadge status={c.status} />
                           </div>

                           <div className="relative pl-8 flex flex-col gap-8">
                             <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-gray-100 dark:bg-gray-800"></div>

                             <TimelineStep done={true} label="Submitted" date={c.date} desc="Issue was successfully logged." />
                             <TimelineStep done={true} label="Under Review" date="Active" desc={`Assigned to ${c.officer}`} />
                             <TimelineStep done={c.status !== 'Pending'} current={c.status === 'In Progress'} label="In Resolution" date="In Progress" desc="Government official is visiting the site." />
                             <TimelineStep done={c.status === 'Resolved'} label="Completed" date="Expected soon" desc="Issue has been fully fixed." />
                           </div>
                        </div>
                     </React.Fragment>
                   ))}
                   {trackSearched && trackId.trim() && !complaints.some(c => c.id === trackId) && (
                     <div className="col-span-2 p-8 bg-white dark:bg-[#111827] rounded-3xl border border-dashed border-gray-200 dark:border-gray-800 flex flex-col items-center gap-3 text-center">
                       <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-900/20 text-red-500 flex items-center justify-center">
                         <AlertTriangle size={22} />
                       </div>
                       <p className="font-bold text-navy dark:text-white">No complaint found</p>
                       <p className="text-sm text-gray-400">Double-check the ID — it should look like CIV-20260430-001.</p>
                     </div>
                   )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Right Sidebar - Info/Recent */}
        <aside className="w-[300px] glass border-l border-gray-100 dark:border-white/5 flex flex-col p-6 shrink-0 gap-8">
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
                   className="p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5 hover:border-saffron dark:hover:border-saffron/50 transition-all cursor-pointer group"
                 >
                   <div className="flex justify-between items-center mb-1">
                     <span className="font-mono text-[10px] font-bold text-navy dark:text-white">{c.id}</span>
                     <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${c.status === 'Resolved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                       {c.status}
                     </span>
                   </div>
                   <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium truncate group-hover:text-navy dark:group-hover:text-white transition-colors">{c.description}</p>
                   <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200 dark:border-white/10">
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
              className="glass-strong rounded-[32px] w-full max-w-xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="p-8 bg-gradient-to-br from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white flex justify-between items-center relative overflow-hidden">
                <div className="aurora-bg" aria-hidden="true">
                  <div className="aurora-blob w-40 h-40 bg-white -top-10 -right-10" />
                </div>
                <div className="relative">
                  <h3 className="font-display font-bold text-2xl">Complaint Profile</h3>
                  <p className="text-white/60 text-sm mt-1">Reference ID: {selectedComplaint.id}</p>
                </div>
                <button
                  onClick={() => setSelectedComplaint(null)}
                  className="relative w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-all font-bold"
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
                   <DetailField label="User Sentiment" value={<span className="text-sm font-bold capitalize dark:text-white">{selectedComplaint.sentiment || 'Neutral'}</span>} />
                </div>

                <div className="bg-gray-50 dark:bg-white/5 p-6 rounded-2xl border border-gray-100 dark:border-white/5">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-2">Detailed Issue Description</span>
                  <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed italic">{selectedComplaint.description}</p>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-black text-navy dark:text-white uppercase tracking-widest flex items-center gap-2">
                    <Stars size={14} className="text-saffron" />
                    AI Suggested Responses
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    {suggestedResponses.length > 0 ? suggestedResponses.map((tpl, i) => (
                      <button
                        key={i}
                        onClick={() => copyToClipboard(tpl)}
                        className="p-3 text-left bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl text-xs text-navy dark:text-gray-200 hover:border-saffron hover:bg-saffron/5 transition-all shadow-sm group relative"
                      >
                        <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Download size={12} className="text-saffron" />
                        </div>
                        {tpl}
                      </button>
                    )) : (
                      <div className="flex gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-pulse"></div>
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-pulse delay-75"></div>
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-pulse delay-150"></div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                  <button
                    onClick={() => updateComplaintStatus(selectedComplaint.id, selectedComplaint.status === 'Pending' ? 'In Progress' : 'Resolved')}
                    className="btn-sheen flex-1 h-12 bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:shadow-lg transition-all active:scale-95"
                  >
                    Update Progress <ArrowRight size={18} />
                  </button>
                  <button
                    onClick={() => setSelectedComplaint(null)}
                    className="px-8 h-12 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-2xl font-bold border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 hover:border-navy dark:hover:border-cta transition-all"
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
        {selectedOfficer && (
          <OfficerReportModal officer={selectedOfficer} onClose={() => setSelectedOfficer(null)} />
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 bg-gradient-to-r from-navy to-navy-light dark:from-[#111827] dark:to-[#1E293B] text-white rounded-2xl shadow-2xl glow-navy flex items-center gap-3 border border-white/10"
          >
            <div className="w-6 h-6 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center text-xs shrink-0">✓</div>
            <span className="font-bold text-sm">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Helper Components

/** Mouse-tracking 3D tilt wrapper — gives cards a premium, physical depth feel. */
function TiltCard({ children, className = '', maxTilt = 8 }: { children: React.ReactNode; className?: string; maxTilt?: number; key?: React.Key }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotateY = (px - 0.5) * maxTilt * 2;
    const rotateX = (0.5 - py) * maxTilt * 2;
    el.style.setProperty('--mx', `${px * 100}%`);
    el.style.setProperty('--my', `${py * 100}%`);
    setStyle({ transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(0)` });
  };

  const handleLeave = () => setStyle({ transform: 'rotateX(0deg) rotateY(0deg) translateZ(0)' });

  return (
    <div className="tilt-wrap">
      <div
        ref={ref}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        className={`tilt-card relative ${className}`}
        style={style}
      >
        <div className="tilt-shine" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

/** Imperative Leaflet controller — lets plain buttons drive the map (flyTo / recenter). */
function MapController({ target, zoom = 16 }: { target: { lat: number; lng: number } | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], zoom, { duration: 1.1 });
  }, [target, zoom, map]);
  return null;
}

/** Switches tile provider based on theme — dark uses a CSS filter over OSM so no API key is needed. */
function PremiumTileLayer({ dark }: { dark: boolean }) {
  return (
    <TileLayer
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution={dark ? '&copy; OpenStreetMap contributors' : '&copy; OpenStreetMap contributors'}
    />
  );
}

function SidebarItem({ icon, label, active, badge, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`btn-sheen flex items-center gap-3 px-5 py-3 mx-2 rounded-xl transition-all relative ${
        active
          ? 'bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white shadow-lg glow-navy'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-navy dark:hover:text-white'
      }`}
    >
      <span className={active ? 'text-saffron-light' : 'text-gray-400'}>{icon}</span>
      <span className="text-[13px] font-bold flex-1 text-left">{label}</span>
      {badge ? <span className="bg-gradient-to-br from-saffron to-saffron-bright text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm">{badge}</span> : null}
    </button>
  );
}

function StatCard({ label, value, icon, color }: any) {
  const colors: any = {
    navy: 'bg-gradient-to-br from-navy to-navy-light text-white shadow-lg shadow-navy/30',
    orange: 'bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow-lg shadow-orange-500/30',
    saffron: 'bg-gradient-to-br from-saffron-light to-saffron-bright text-white shadow-lg shadow-saffron/30',
    green: 'bg-gradient-to-br from-green-400 to-green-600 text-white shadow-lg shadow-green-500/30'
  };
  return (
    <TiltCard maxTilt={6} className="bg-white dark:bg-[#111827] p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col gap-1 hover:shadow-xl transition-shadow">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-2 ${colors[color]}`} style={{ transform: 'translateZ(20px)' }}>{icon}</div>
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
      <span className="text-3xl font-display font-bold leading-tight dark:text-white" style={{ transform: 'translateZ(10px)' }}>{value}</span>
    </TiltCard>
  );
}

function MiniStat({ color, label, value, icon }: any) {
  const colors: any = {
    navy: 'bg-gradient-to-br from-navy to-navy-light text-white',
    saffron: 'bg-gradient-to-br from-saffron-light to-saffron-bright text-white',
    green: 'bg-gradient-to-br from-green-500 to-green-700 text-white'
  };
  return (
    <div className="flex items-center justify-between bg-gray-50 dark:bg-white/5 p-2.5 rounded-2xl border border-gray-100 dark:border-white/5">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-sm ${colors[color]}`}>{icon}</div>
        <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <span className="text-lg font-display font-bold text-navy dark:text-white">{value}</span>
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
    <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-xl flex flex-col gap-1">
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</span>
      <div className="text-sm font-bold text-navy dark:text-white">{value}</div>
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

function OfficerReportModal({ officer, onClose }: { officer: { name: string; ward: string; count: number; solved: number; pending: number; rating: number }; onClose: () => void }) {
  const efficiency = officer.count === 0 ? 0 : Math.round((officer.solved / officer.count) * 100);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-navy/70 dark:bg-black/70 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="glass-strong rounded-[32px] w-full max-w-md shadow-2xl overflow-hidden"
      >
        <div className="p-8 bg-gradient-to-br from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white relative overflow-hidden">
          <div className="aurora-bg" aria-hidden="true">
            <div className="aurora-blob w-40 h-40 bg-white -top-10 -right-10" />
          </div>
          <div className="relative flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center text-2xl">👨‍💼</div>
            <div>
              <h3 className="font-display font-bold text-xl">{officer.name}</h3>
              <p className="text-white/70 text-xs font-bold uppercase tracking-widest mt-0.5">{officer.ward}</p>
            </div>
            <button
              onClick={onClose}
              className="ml-auto w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-all"
            ><X size={16} /></button>
          </div>
        </div>

        <div className="p-8 space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-2xl flex flex-col gap-1 text-center">
              <span className="text-[9px] font-bold text-gray-400 uppercase">Assigned</span>
              <span className="text-2xl font-display font-bold text-navy dark:text-white">{officer.count}</span>
            </div>
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-2xl flex flex-col gap-1 text-center">
              <span className="text-[9px] font-bold text-green-500 uppercase">Solved</span>
              <span className="text-2xl font-display font-bold text-green-600 dark:text-green-400">{officer.solved}</span>
            </div>
            <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-2xl flex flex-col gap-1 text-center">
              <span className="text-[9px] font-bold text-orange-400 uppercase">Pending</span>
              <span className="text-2xl font-display font-bold text-orange-600 dark:text-orange-400">{officer.pending}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase">
              <span className="flex items-center gap-1.5"><Gauge size={12} /> Efficiency Rate</span>
              <span>{efficiency}%</span>
            </div>
            <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${efficiency}%` }}
                transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
                className="h-full bg-gradient-to-r from-navy to-cta dark:from-cta dark:to-saffron rounded-full"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-yellow-50 dark:bg-yellow-900/10 rounded-2xl">
            <span className="text-xs font-bold text-gray-500 flex items-center gap-2"><Briefcase size={14} /> Citizen Rating</span>
            <span className="text-sm font-bold text-yellow-600 dark:text-yellow-400 flex items-center gap-1">★ {officer.rating.toFixed(1)} / 5.0</span>
          </div>

          <button
            onClick={onClose}
            className="w-full h-12 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-2xl font-bold border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 hover:border-navy dark:hover:border-cta transition-all"
          >Close</button>
        </div>
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
