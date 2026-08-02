import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  ArrowRight,
  Mic,
  Send,
  CheckCircle2,
  Clock,
  ChevronRight,
  AlertTriangle,
  History,
  Download,
  TrendingUp,
  Moon,
  Sun,
  Camera,
  Star,
  LogOut,
  ShieldCheck,
  Award,
  Stars,
  Activity,
  X,
  Locate,
  Briefcase,
  Gauge,
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
} from 'recharts';
import { MapContainer, TileLayer, Popup, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Complaint, ViewType, ChatMessage, SystemNotification } from './types';
import { useI18n } from './i18n/I18nContext';
import { LanguagePicker } from './components/LanguagePicker';
import { useLiveComplaints } from './hooks/useLiveComplaints';
import { createComplaint, rateComplaint } from './services/complaintService';
import { useAuth } from './context/AuthContext';
import { useTheme } from './context/ThemeContext';
import { LoginScreen } from './components/LoginScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button } from './components/Button';
import { Skeleton, SkeletonRegion } from './components/Skeleton';
import { MobileNav } from './components/MobileNav';
import { PageBackground } from './components/backgrounds/PageBackground';
import { useThemeTokens } from './hooks/useThemeTokens';
import { sendChat, getBrowserLocation, type ChatTurn } from './services/chatService';
import { OFFICERS, RESPONSES } from './constants';
import { analyzeComplaint, generateResponseTemplates } from './services/aiService';

type LivePin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  confidence: 'exact' | 'approximate' | 'city';
  category: string;
  priority: string;
};

type OfficerStats = {
  name: string;
  ward: string;
  count: number;
  solved: number;
  pending: number;
  rating: number;
};

/**
 * Shared view transition — "fade through" with a small rise.
 * Exit runs at ~65% of the entrance duration so the outgoing view clears
 * quickly and the incoming one feels responsive rather than delayed.
 * Only opacity/transform animate, so this stays on the compositor.
 */
const VIEW_TRANSITION = {
  initial: { opacity: 0, y: 12, scale: 0.995 },
  animate: {
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.34, ease: [0.16, 1, 0.3, 1] as const },
  },
  exit: {
    opacity: 0, y: -8, scale: 0.995,
    transition: { duration: 0.22, ease: [0.4, 0, 1, 1] as const },
  },
};

/** Must mirror LIMITS.MAX_HISTORY_MESSAGES in server/limits.ts. */
const MAX_CHAT_HISTORY = 12;
/** Guard against pathological paste — server clamps too, this is just UX. */
const MAX_MESSAGE_CHARS = 2000;

const SLA_LIMITS: Record<string, number> = {
  '💧 Water Supply': 24 * 3600 * 1000,      // 1 day
  '🛣️ Roads & Transport': 72 * 3600 * 1000, // 3 days
  '⚡ Electricity': 12 * 3600 * 1000,        // 12 hours
  '🏥 Healthcare': 48 * 3600 * 1000,         // 2 days
  '🗑️ Sanitation': 48 * 3600 * 1000,        // 2 days
  '🚓 Law & Order': 6 * 3600 * 1000,         // 6 hours
  General: 48 * 3600 * 1000,
  Default: 48 * 3600 * 1000,
};

const DEPARTMENTS: Record<string, string> = {
  '💧 Water Supply': 'Water Department',
  '🛣️ Roads & Transport': 'Roads Department',
  '⚡ Electricity': 'Electricity Board',
  '🏥 Healthcare': 'Municipal Corporation',
  '🗑️ Sanitation': 'Sanitation Department',
  '🚓 Law & Order': 'Police Department',
  General: 'General Administration',
};

/** SLA clocks skip weekends — a Saturday deadline rolls to Monday. */
const calculateSLADeadline = (category: string, startTime: number): number => {
  const baseSLA = SLA_LIMITS[category] || SLA_LIMITS.Default;
  let deadline = startTime + baseSLA;
  const day = new Date(deadline).getDay();
  if (day === 6) deadline += 48 * 3600 * 1000;      // Sat → Mon
  else if (day === 0) deadline += 24 * 3600 * 1000; // Sun → Mon
  return deadline;
};

export default function App() {
  const [view, setView] = useState<ViewType>('chat');
  // Language now lives in I18nProvider so the picker, <html lang/dir> and
  // every component agree. `t` falls back to English per key.
  const { lang, t } = useI18n();
  /**
   * Complaints come from the database and stay current over SSE.
   *
   * This was `useState<Complaint[]>([])` seeded with three hardcoded rows:
   * a refresh erased anything a citizen filed, and the citizen and admin
   * portals were two unrelated arrays that could never see each other.
   */
  const {
    complaints,
    loading: complaintsLoading,
    error: complaintsError,
    live: complaintsLive,
    refresh: refreshComplaints,
    patch: patchComplaint,
    prepend: prependComplaint,
  } = useLiveComplaints({ limit: 300 });
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
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [showFeedbackModal, setShowFeedbackModal] = useState<Complaint | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [trackSearched, setTrackSearched] = useState(false);
  const [selectedOfficer, setSelectedOfficer] = useState<OfficerStats | null>(null);
  const [mapFlyTarget, setMapFlyTarget] = useState<{ lat: number; lng: number } | null>(null);
  // AI chat + live map
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [livePins, setLivePins] = useState<LivePin[]>([]);
  const [activePin, setActivePin] = useState<LivePin | null>(null);
  const [showLiveMap, setShowLiveMap] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [aiProvider, setAiProvider] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  /** Every pending bot timeout, so they can be cancelled on unmount. */
  const botTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const { status, user, onSignedIn, signOut, signingOut } = useAuth();
  const { isDark: isDarkMode, toggleTheme } = useTheme();
  const isAuthenticated = status === 'authenticated';

  const handleSignedIn = useCallback((u: { identifier: string; channel: 'phone' | 'google' }) => {
    onSignedIn(u);
    setShowOnboarding(true);
  }, [onSignedIn]);

  // Clear every scheduled bot reply on unmount — otherwise each timeout
  // fires setState on an unmounted tree (a real leak in the old code).
  useEffect(() => {
    const timers = botTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  /**
   * The client-side auto-escalation timer that lived here has been removed.
   *
   * It flipped `escalated` in this browser's state only — the server never
   * heard about it, other users never saw it, and closing the tab undid it.
   * An SLA breach that exists only in one person's tab is not an escalation.
   * server/sla.ts now sweeps centrally and the result arrives over SSE.
   */

  // Initial notifications
  useEffect(() => {
    setNotifications([
      { id: '1', title: 'Welcome to CivicAI', message: 'Thank you for joining our smart governance platform.', type: 'info', timestamp: '2 hours ago', read: false },
      { id: '2', title: 'Status Update', message: 'Your complaint CIV-20260430-001 has been assigned to an officer.', type: 'success', timestamp: '5 hours ago', read: true },
    ]);
  }, []);

  // Fetch AI response templates when a complaint is selected.
  // `cancelled` prevents a slow response for complaint A from overwriting
  // the templates of complaint B if the user switches quickly.
  useEffect(() => {
    if (!selectedComplaint) {
      setSuggestedResponses([]);
      setLoadingTemplates(false);
      return;
    }

    let cancelled = false;
    setLoadingTemplates(true);
    setSuggestedResponses([]);

    generateResponseTemplates(selectedComplaint)
      .then(templates => { if (!cancelled) setSuggestedResponses(templates); })
      .finally(() => { if (!cancelled) setLoadingTemplates(false); });

    return () => { cancelled = true; };
  }, [selectedComplaint]);

  // Initialize with seed data
  useEffect(() => {
    // Greeting
    botReply(RESPONSES[lang].greeting, 500);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Ask for GPS once the citizen is signed in — improves map accuracy
  useEffect(() => {
    if (!isAuthenticated) return;
    getBrowserLocation().then(coords => { if (coords) setUserCoords(coords); });
  }, [isAuthenticated]);

  const handleLogout = async () => {
    await signOut();
    showToast('Signed out securely.');
  };

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const chart = useThemeTokens();

  // Dismiss the notifications dropdown on Escape or an outside click —
  // it previously stayed open and trapped nothing, which is a keyboard trap.
  useEffect(() => {
    if (!showNotifications) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNotifications(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!notificationsRef.current?.contains(e.target as Node)) setShowNotifications(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [showNotifications]);

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

  /** Single-slot toast. Re-firing resets the timer instead of stacking them. */
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const generateID = () => {
    const d = new Date();
    const ymd = d.getFullYear().toString() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    const seq = String(complaints.length + 1).padStart(3, '0');
    return `CIV-${ymd}-${seq}`;
  };

  /** Schedules a bot message. The timer is tracked so unmount can cancel it. */
  const botReply = useCallback((content: string, delay = 800) => {
    setIsTyping(true);
    const timer = setTimeout(() => {
      botTimers.current.delete(timer);
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content,
        type: 'bot',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    }, delay);
    botTimers.current.add(timer);
  }, []);

  const handleSendMessage = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    if (text.length > MAX_MESSAGE_CHARS) {
      showToast(`Message too long — please keep it under ${MAX_MESSAGE_CHARS} characters.`);
      return;
    }
    setChatInput('');

    const userMsg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: text,
      type: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setChatHistory(prev => [...prev, { role: 'user' as const, content: text }].slice(-MAX_CHAT_HISTORY));
    processUserInput(text);
  };

  /** Routes a message to the AI backend and syncs the live map. */
  const runAiTurn = async (text: string) => {
    setIsTyping(true);
    const res = await sendChat(text, chatHistory, userCoords);
    setIsTyping(false);

    setChatHistory(prev => [...prev, { role: 'assistant' as const, content: res.reply }].slice(-MAX_CHAT_HISTORY));
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

  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset immediately so re-selecting the same file still fires onChange.
    e.target.value = '';
    if (!file) return;

    // Validate before reading — the old version accepted any file of any size
    // and base64'd it straight into React state.
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      showToast('Please choose a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast('Image is too large — maximum size is 5 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => showToast('Could not read that image. Please try another file.');
    reader.onloadend = () => {
      if (typeof reader.result !== 'string') return;
      setPendingComplaint(prev => ({ ...prev, photoUrl: reader.result as string }));
      botReply("📸 Photo attached! Now, let's finalize the category.");
    };
    reader.readAsDataURL(file);
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
      
      // Persist first, then show. Pushing into local state and calling it
      // filed is what made complaints vanish on refresh.
      prependComplaint(newComplaint);
      void createComplaint({
        category: newComplaint.category,
        description: newComplaint.description,
        priority: newComplaint.priority,
        department: newComplaint.department,
        lat: newComplaint.lat,
        lng: newComplaint.lng,
        state: 'Delhi',
        district: 'New Delhi',
      } as any)
        .then(({ complaint, duplicate }) => {
          void refreshComplaints();
          if (duplicate) {
            botReply(
              `This looks like it may already be reported (${duplicate.confidence}% match with ${duplicate.of}: ${duplicate.reasons.join(', ')}). ` +
              `Your complaint has still been registered separately and will be tracked.`,
              900,
            );
          }
        })
        .catch(err => showToast(err.message || 'Could not save the complaint.'));
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
    patchComplaint(id, { status: nextStatus });
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

  const recognitionRef = useRef<any>(null);

  const startListening = () => {
    // Toggle off if already listening — previously there was no way to stop.
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('Voice input is not supported in this browser.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      // Hand the browser the actual locale; it degrades to its default if
      // the language pack is missing, which is better than forcing Hindi.
      recognition.lang = lang === 'en' ? 'en-US' : `${lang}-IN`;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (e: any) => {
        const transcript = e.results?.[0]?.[0]?.transcript ?? '';
        // Write to state, not the DOM node — the textarea is controlled now,
        // so a direct .value assignment was being discarded on next render.
        if (transcript) setChatInput(prev => (prev ? `${prev} ${transcript}` : transcript));
      };
      recognition.onerror = (e: any) => {
        setIsListening(false);
        if (e?.error === 'not-allowed') showToast('Microphone permission denied.');
        else if (e?.error !== 'aborted') showToast('Voice input failed. Please try again.');
      };
      recognition.onend = () => setIsListening(false);

      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
      showToast('Could not start voice input.');
    }
  };

  // Stop any live recognition when the component unmounts.
  useEffect(() => () => {
    try { recognitionRef.current?.abort?.(); } catch { /* already stopped */ }
  }, []);

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

  if (status !== 'authenticated') {
    return <LoginScreen onSignedIn={handleSignedIn} />;
  }

  return (
    <div
      className="relative isolate flex flex-col h-screen overflow-hidden transition-colors duration-300"
      style={{ background: 'var(--color-bg-main)', color: 'var(--color-content)' }}
    >
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* Ambient depth for the citizen shell. Previously this was blur blobs
          gated on `isDarkMode`, which left light mode visually flat. Threads
          takes its colour as a uniform, so one component now serves both
          themes instead of dark getting the only treatment. */}
      <PageBackground variant="app" />

      {/* Top Navigation */}
      <nav
        className="h-20 glass border-b px-4 sm:px-8 flex items-center justify-between shrink-0 relative z-[100]"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="float-y w-11 h-11 bg-gradient-to-br from-cta to-saffron rounded-xl flex items-center justify-center text-white shadow-lg shrink-0">
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-xl tracking-tight text-gradient-premium">CivicAI</h1>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" aria-hidden="true" />
              <span className="text-[12px] font-black uppercase text-content-3 tracking-widest truncate">
                New Delhi Municipal Council
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-6">
          <div
            className="hidden sm:flex"
          >
            <LanguagePicker />
          </div>

          <div className="hidden sm:block h-6 w-px" style={{ background: 'var(--color-border)' }} />

          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              title={isDarkMode ? 'Light mode' : 'Dark mode'}
              className="w-10 h-10 rounded-xl bordered surface-2 grid place-items-center text-content-3 hover:text-cta transition-colors"
            >
              {isDarkMode ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
            
            <div className="relative" ref={notificationsRef}>
              <button
                onClick={() => setShowNotifications(v => !v)}
                aria-haspopup="true"
                aria-expanded={showNotifications}
                aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
                className="relative w-10 h-10 rounded-xl bordered surface-2 grid place-items-center text-content-3 hover:text-cta transition-colors"
              >
                <Bell size={18} aria-hidden="true" />
                {unreadCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-2 right-2 w-2 h-2 bg-saffron rounded-full ring-2"
                    style={{ ['--tw-ring-color' as any]: 'var(--color-surface)' }}
                  />
                )}
              </button>

              <AnimatePresence>
                {showNotifications && (
                  <motion.div
                    role="dialog"
                    aria-label="Notifications"
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-80 glass-strong rounded-3xl elev-3 bordered overflow-hidden z-[100]"
                  >
                    <div
                      className="p-4 flex justify-between items-center surface-2"
                      style={{ borderBottom: '1px solid var(--color-border)' }}
                    >
                      <span className="text-[12px] font-black uppercase tracking-widest text-content">Notifications</span>
                      <button
                        onClick={markAllNotificationsRead}
                        disabled={unreadCount === 0}
                        className="text-[12px] font-bold text-saffron uppercase hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                      >
                        Mark all read
                      </button>
                    </div>
                    <div className="max-h-[300px] overflow-auto">
                      {notifications.length === 0 ? (
                        <p className="p-6 text-center text-[11px] text-content-3 font-semibold">
                          You're all caught up — no notifications yet.
                        </p>
                      ) : notifications.map(n => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => markNotificationRead(n.id)}
                          className="w-full text-left p-4 hover:bg-[var(--color-surface-2)] transition-colors"
                          style={{
                            borderBottom: '1px solid var(--color-border)',
                            background: n.read ? undefined : 'color-mix(in srgb, var(--color-saffron) 8%, transparent)',
                          }}
                        >
                          <h4 className="text-xs font-bold text-content flex items-center gap-2">
                            {!n.read && <span className="w-1.5 h-1.5 bg-saffron rounded-full shrink-0" aria-hidden="true" />}
                            {n.title}
                          </h4>
                          <p className="text-[11px] text-content-2 mt-0.5">{n.message}</p>
                          <span className="text-[11px] font-bold text-content-3 mt-2 block">{n.timestamp}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button
              onClick={() => setView('dashboard')}
              aria-current={view === 'dashboard' ? 'page' : undefined}
              className={`hidden md:flex items-center gap-2 px-4 h-10 rounded-xl text-xs font-bold transition-colors ${
                view === 'dashboard'
                  ? 'bg-cta text-white shadow-sm'
                  : 'surface-2 bordered text-content-2 hover:text-cta'
              }`}
            >
              <LayoutDashboard size={16} aria-hidden="true" /> Dashboard
            </button>

            <button
              onClick={handleLogout}
              disabled={signingOut}
              title="Sign out"
              aria-label="Sign out"
              aria-busy={signingOut || undefined}
              className="w-10 h-10 rounded-xl grid place-items-center text-content-3 hover:text-danger transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {signingOut ? (
                <span
                  aria-hidden="true"
                  className="w-4 h-4 border-2 rounded-full animate-spin"
                  style={{ borderColor: 'var(--color-border-strong)', borderTopColor: 'var(--color-danger)' }}
                />
              ) : (
                <LogOut size={18} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden relative z-10">
        {/* Sidebar */}
        <aside
          className="hidden lg:flex w-[240px] glass border-r flex-col py-6 shrink-0 overflow-y-auto"
          style={{ borderColor: 'var(--color-border)' }}
          aria-label="Main navigation"
        >
          <div className="px-5 mb-2 text-[12px] font-bold text-content-3 tracking-[0.15em] uppercase">Main Menu</div>
          <SidebarItem 
            active={view === 'chat'} 
            onClick={() => setView('chat')} 
            icon={<MessageSquare size={18} />} 
            label={t('nav.chat')} 
          />
          <SidebarItem 
            active={view === 'dashboard'} 
            onClick={() => setView('dashboard')} 
            icon={<LayoutDashboard size={18} />} 
            label={t('nav.dashboard')} 
            badge={stats.pending}
          />
          <SidebarItem 
            active={view === 'track'} 
            onClick={() => setView('track')} 
            icon={<Search size={18} />} 
            label={t('nav.track')} 
          />
          <SidebarItem 
            active={view === 'public_feed'} 
            onClick={() => setView('public_feed')} 
            icon={<TrendingUp size={18} />} 
            label={t('nav.feed')} 
          />

          <div className="px-5 mt-6 mb-2 text-[12px] font-bold text-content-3 tracking-[0.15em] uppercase">Categories</div>
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
        {/* id + tabIndex make the "Skip to main content" link actually work —
            it previously pointed at a #main-content that did not exist. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-hidden p-4 sm:p-6 pb-[calc(72px+env(safe-area-inset-bottom,0px))] lg:pb-6 flex flex-col focus:outline-none"
        >
          <ErrorBoundary scope={`view:${view}`}>
          <AnimatePresence mode="wait" initial={false}>
            {view === 'chat' && (
              <motion.div 
                key="chat"
                variants={VIEW_TRANSITION}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex-1 flex flex-col gap-4 overflow-hidden"
              >
                <div className="flex items-center gap-4 pb-4 border-b border-[var(--color-border)]">
                  <div className="w-12 h-12 bg-cta rounded-2xl flex items-center justify-center text-2xl elev-2">🤖</div>
                  <div className="flex-1">
                    <h2 className="font-display font-bold text-lg">{lang === 'en' ? 'CivicAI Assistant' : 'CivicAI सहायक'}</h2>
                    <div className="flex items-center gap-1.5 text-xs text-content-3">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                      {lang === 'en' ? 'Online • Govt. Verified System' : 'ऑनलाइन • सरकारी प्रणाली'}
                      {aiProvider && (
                        <span className="ml-1 px-1.5 py-0.5 rounded surface-2 text-[11px] font-bold uppercase tracking-wide">
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
                          ? 'bg-cta text-white border-navy'
                          : 'border-[var(--color-border-strong)]  text-content-2 hover:text-cta hover:border-cta'
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
                      className={`rounded-2xl overflow-hidden border border-[var(--color-border)]  relative shrink-0 shadow-lg map-premium ${isDarkMode ? 'map-dark' : ''}`}
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
                              color: chart.priority[
                                (p.priority as keyof typeof chart.priority)
                              ] ?? chart.priority.Low,
                              fillOpacity: i === livePins.length - 1 ? 0.75 : 0.35,
                              weight: i === livePins.length - 1 ? 3 : 1.5,
                            }}
                            eventHandlers={{ click: () => setActivePin(p) }}
                          >
                            <Popup>
                              <div className="text-xs">
                                <strong>{p.category}</strong><br />
                                {p.label}<br />
                                <span className="text-content-2">
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
                            pathOptions={{ color: chart.markerUser, fillOpacity: 0.9, weight: 2 }}
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
                        className="absolute top-3 right-3 z-[500] w-9 h-9 rounded-xl glass-strong border shadow-lg flex items-center justify-center text-content hover:text-cta hover:-translate-y-0.5 transition-all"
                      >
                        <Locate size={16} />
                      </button>

                      {activePin && (
                        <div className="absolute bottom-3 left-3 right-3 bg-white/95 backdrop-blur px-4 py-2.5 rounded-xl border border-[var(--color-border)] shadow-lg z-[500] flex items-center gap-3">
                          <MapPin size={15} className="text-saffron shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold text-content truncate">{activePin.label}</p>
                            <p className="text-[12px] text-content-3">
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
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 border border-[var(--color-border)] ${m.type === 'bot' ? 'bg-cta text-white' : 'bg-saffron text-white'}`}>
                        {m.type === 'bot' ? '🤖' : 'RC'}
                      </div>
                      <div className="flex flex-col max-w-[75%]">
                        <div className={`p-4 rounded-2xl text-sm leading-relaxed elev-1 whitespace-pre-line relative overflow-hidden ${
                          m.type === 'bot' 
                            ? 'surface  text-content  border-b-4 border-[var(--color-border)] ' 
                            : 'bg-cta dark:bg-saffron text-white rounded-tr-none'
                        }`}>
                          {m.content}
                          {m.content.includes("Photo attached!") && pendingComplaint.photoUrl && (
                            <img src={pendingComplaint.photoUrl} className="mt-2 rounded-lg max-h-40 w-full object-cover border border-[var(--color-border)]" alt="Complaint Attachment" />
                          )}
                        </div>
                        <span className={`text-[12px] text-content-3 mt-1 ${m.type === 'user' ? 'text-right' : ''}`}>{m.timestamp}</span>
                      </div>
                    </div>
                  ))}
                  {isTyping && (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-cta flex items-center justify-center text-sm text-white shrink-0">🤖</div>
                      <div className="surface p-3 pr-6 rounded-2xl flex gap-1 elev-1">
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
                          className="px-4 py-1.5 bg-cta text-white rounded-full text-xs font-bold flex items-center gap-1.5 hover:bg-saffron-bright transition-all"
                        >
                          <Award size={12} /> Yes, it's {aiSuggestedCategory}
                        </button>
                        {RESPONSES[lang].categories.filter(c => c !== aiSuggestedCategory).map(cat => (
                          <button 
                            key={cat}
                            onClick={() => handleSendMessage(cat)}
                            className="px-4 py-1.5 surface border border-[var(--color-border-strong)] rounded-full text-xs font-semibold hover:border-saffron hover:text-saffron transition-all"
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
                            className="px-4 py-1.5 surface border border-[var(--color-border-strong)] rounded-full text-xs font-semibold hover:border-saffron hover:text-saffron transition-all"
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
                          className="px-4 py-1.5 surface border border-[var(--color-border-strong)] rounded-full text-xs font-semibold hover:border-saffron hover:text-saffron transition-all"
                        >
                          {label}
                        </button>
                      ))
                    )}
                  </div>
                  <form
                    onSubmit={e => { e.preventDefault(); handleSendMessage(chatInput); }}
                    className="glass-strong bordered border-2 rounded-2xl flex items-end p-2 focus-within:border-cta transition-colors elev-1"
                  >
                    <div className="flex items-center gap-1">
                      <label
                        htmlFor="photo-upload"
                        title="Attach a photo"
                        className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-cta ${
                          pendingComplaint.photoUrl ? 'bg-saffron/10 text-saffron' : 'text-content-3 hover:text-saffron'
                        }`}
                      >
                        <Camera size={18} aria-hidden="true" />
                        <span className="sr-only-focusable">Attach a photo</span>
                        <input
                          id="photo-upload"
                          type="file"
                          className="sr-only-focusable"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleFileUpload}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={startListening}
                        aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                        aria-pressed={isListening}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                          isListening ? 'bg-danger-pale text-danger animate-pulse' : 'text-content-3 hover:text-saffron'
                        }`}
                      >
                        <Mic size={18} aria-hidden="true" />
                      </button>
                    </div>

                    <label htmlFor="chat-input" className="sr-only-focusable">
                      {lang === 'en' ? 'Describe your problem' : 'अपनी समस्या बताएं'}
                    </label>
                    <textarea
                      id="chat-input"
                      ref={chatInputRef}
                      value={chatInput}
                      maxLength={MAX_MESSAGE_CHARS}
                      placeholder={lang === 'en' ? 'Describe your problem…' : 'अपनी समस्या बताएं…'}
                      className="flex-1 border-none bg-transparent focus:ring-0 outline-none text-sm py-2 px-1 resize-none h-10 max-h-32 text-content placeholder:text-content-3"
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage(chatInput);
                        }
                      }}
                    />

                    <button
                      type="submit"
                      disabled={!chatInput.trim() || isTyping}
                      aria-label="Send message"
                      className="btn-sheen w-10 h-10 bg-gradient-to-br from-cta to-saffron text-white rounded-full flex items-center justify-center hover:shadow-lg hover:-translate-y-0.5 transition-all shrink-0 disabled:opacity-40 disabled:hover:translate-y-0 disabled:cursor-not-allowed disabled:hover:shadow-none"
                    >
                      <Send size={16} aria-hidden="true" />
                    </button>
                  </form>
                </div>
              </motion.div>
            )}

            {view === 'dashboard' && (
              <motion.div 
                key="dashboard"
                variants={VIEW_TRANSITION}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex-1 flex flex-col gap-6 overflow-hidden"
              >
                <div className="flex items-center justify-between shrink-0">
                  <div>
                    <h2 className="font-display font-bold text-2xl">{lang === 'en' ? 'Officer Dashboard' : 'अधिकारी डैशबोर्ड'}</h2>
                    <p className="text-content-3 text-sm mt-0.5">{lang === 'en' ? 'Track and manage citizen submissions' : 'प्रस्तुतियों को ट्रैक करें और प्रबंधित करें'}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex surface rounded-xl border border-[var(--color-border)] p-1 elev-1">
                      <button
                        onClick={() => setDashboardTab('overview')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'overview' ? 'bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white shadow-sm' : 'text-content-2 hover:text-cta '}`}
                      >Overview</button>
                      <button
                        onClick={() => setDashboardTab('analytics')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'analytics' ? 'bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white shadow-sm' : 'text-content-2 hover:text-cta '}`}
                      >Analytics</button>
                      <button
                        onClick={() => setDashboardTab('workload')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'workload' ? 'bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white shadow-sm' : 'text-content-2 hover:text-cta '}`}
                      >Workload</button>
                      <button
                        onClick={() => setDashboardTab('heatmap')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'heatmap' ? 'bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white shadow-sm' : 'text-content-2 hover:text-cta '}`}
                      >Heatmap</button>
                    </div>
                    <button
                      onClick={exportToCSV}
                      className="btn-sheen px-4 h-10 surface border border-[var(--color-border-strong)] rounded-xl text-content flex items-center gap-2 text-xs font-bold hover:border-cta dark:hover:border-cta transition-all elev-1"
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

                    <div className="flex-1 surface rounded-2xl border border-[var(--color-border)] elev-1 overflow-hidden flex flex-col">
                      <div className="px-6 py-4 surface-2 border-b border-[var(--color-border)] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <h3 className="font-bold text-sm tracking-wide shrink-0">COMPLAINT REGISTRY</h3>

                        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                          <div className="relative flex-1 sm:w-64">
                            <Search className="absolute left-3 top-2.5 text-content-3" size={14} />
                            <input
                              type="text"
                              placeholder="Search complaints..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full h-9 pl-9 pr-4 surface rounded-lg border border-[var(--color-border-strong)] text-xs focus:ring-1 focus:ring-cta focus:border-cta dark:focus:ring-cta dark:focus:border-cta transition-all"
                            />
                          </div>
                          <div className="flex gap-1 surface-2 p-1 rounded-lg">
                            {(['all', 'Pending', 'In Progress', 'Resolved'] as const).map(f => (
                              <button
                                key={f}
                                onClick={() => setDashboardFilter(f)}
                                className={`px-3 py-1 rounded-md text-[12px] font-bold transition-all ${
                                  dashboardFilter === f ? 'surface  text-content  shadow-sm' : 'text-content-3 hover:text-cta '
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
                            <tr className="border-b border-[var(--color-border)] sticky top-0 surface z-10">
                              <th className="px-6 py-4 text-[12px] font-bold text-content-3 uppercase">ID</th>
                              <th className="px-6 py-4 text-[12px] font-bold text-content-3 uppercase">Category</th>
                              <th className="px-6 py-4 text-[12px] font-bold text-content-3 uppercase">Description</th>
                              <th className="px-6 py-4 text-[12px] font-bold text-content-3 uppercase">Status</th>
                              <th className="px-6 py-4 text-[12px] font-bold text-content-3 uppercase">SLA Timer</th>
                              <th className="px-6 py-4 text-[12px] font-bold text-content-3 uppercase">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-border)]">
                            {filteredComplaints.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="p-0">
                                  <div className="relative isolate overflow-hidden px-6 py-14 text-center">
                                    <PageBackground variant="empty" />
                                    <p className="text-content-3 text-sm">
                                      No complaints found matching your criteria.
                                    </p>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              filteredComplaints.map(c => (
                                <tr key={c.id} className="hover:bg-[var(--color-surface-2)] transition-colors">
                                  <td className="px-6 py-4 font-mono text-xs font-bold text-content">{c.id}</td>
                                  <td className="px-6 py-4 text-xs font-medium">
                                    <div className="flex flex-col gap-1">
                                      {c.category}
                                      <PriorityBadge priority={c.priority} />
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-xs text-content-2 max-w-[200px] truncate">{c.description}</td>
                                  <td className="px-6 py-4">
                                    <StatusBadge status={c.status} />
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <SLATimer deadline={c.deadline} status={c.status} />
                                  </td>
                                  <td className="px-6 py-4">
                                    <button
                                      onClick={() => setSelectedComplaint(c)}
                                      className="btn-sheen px-3 py-1.5 bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white rounded-lg text-[12px] font-bold hover:shadow-md transition-all"
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
                      <div className="surface p-6 rounded-2xl border border-[var(--color-border)] elev-1 flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="text-saffron" size={20} />
                          <h3 className="font-display font-bold text-sm">Complaints by Category</h3>
                        </div>
                        <div className="h-[300px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={categoryData} layout="vertical" margin={{ left: 20, right: 30 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={chart.grid} />
                              <XAxis type="number" hide />
                              <YAxis 
                                dataKey="name" 
                                type="category" 
                                width={120} 
                                axisLine={false} 
                                tickLine={false}
                                style={{ fontSize: '11px', fontWeight: 600, fill: chart.content }}
                              />
                              <Tooltip 
                                contentStyle={chart.tooltip}
                                cursor={{ fill: 'transparent' }}
                              />
                              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20}>
                                {categoryData.map((_entry, index) => (
                                  <Cell key={`cell-${index}`} fill={chart.series[index % chart.series.length]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="surface p-6 rounded-2xl border border-[var(--color-border)] elev-1 flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="text-content" size={20} />
                          <h3 className="font-display font-bold text-sm">7-Day Volume Trend</h3>
                        </div>
                        <div className="h-[300px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={volumeData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
                              <XAxis 
                                dataKey="date" 
                                axisLine={false} 
                                tickLine={false} 
                                style={{ fontSize: '10px', fill: chart.axis }}
                              />
                              <YAxis 
                                axisLine={false} 
                                tickLine={false} 
                                style={{ fontSize: '10px', fill: chart.axis }}
                              />
                              <Tooltip contentStyle={chart.tooltip} />
                              <Line 
                                type="monotone" 
                                dataKey="count" 
                                stroke={chart.series[1]} 
                                strokeWidth={3} 
                                dot={{ fill: chart.series[1], strokeWidth: 2, r: 4, stroke: chart.surface }}
                                activeDot={{ r: 6, strokeWidth: 0 }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>

                    <div className="surface p-6 rounded-2xl border border-[var(--color-border)] elev-1">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="font-display font-bold text-sm">Resolution Performance</h3>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-cta"></div>
                            <span className="text-[12px] font-bold text-content-2 uppercase">Total</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                            <span className="text-[12px] font-bold text-content-2 uppercase">Resolved</span>
                          </div>
                        </div>
                      </div>
                      <div className="h-[250px] w-full">
                         <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={officerWorkload} barGap={8}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} style={{ fontSize: '10px', fill: chart.axis }} />
                              <YAxis axisLine={false} tickLine={false} style={{ fontSize: '10px', fill: chart.axis }} />
                              <Tooltip cursor={{ fill: chart.grid, fillOpacity: 0.25 }} contentStyle={chart.tooltip} />
                              <Bar dataKey="count" name="Total Assigned" fill={chart.series[0]} radius={[4, 4, 0, 0]} barSize={24} />
                              <Bar dataKey="solved" name="Resolved" fill={chart.series[2]} radius={[4, 4, 0, 0]} barSize={24} />
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
                        <TiltCard key={off.name} maxTilt={5} className="surface p-6 rounded-3xl bordered elev-2 flex flex-col gap-6 transition-shadow hover:elev-3 group">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 surface-2 rounded-2xl flex items-center justify-center text-xl grayscale group-hover:grayscale-0 transition-all">👨‍💼</div>
                            <div>
                              <h4 className="font-display font-bold text-content">{off.name}</h4>
                              <p className="text-[12px] font-bold text-saffron uppercase tracking-widest">{off.ward}</p>
                            </div>
                            <div className="ml-auto bg-yellow-50 text-yellow-600 px-2 py-1 rounded-lg flex items-center gap-1 text-xs font-bold">
                              ★ {off.rating.toFixed(1)}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-3">
                            <div className="p-3 surface-2 rounded-2xl flex flex-col gap-1">
                              <span className="text-[11px] font-bold text-content-3 uppercase tracking-tighter">Assigned</span>
                              <span className="text-xl font-display font-bold text-content">{off.count}</span>
                            </div>
                            <div className="p-3 bg-green-50 rounded-2xl flex flex-col gap-1">
                              <span className="text-[11px] font-bold text-green-400 uppercase tracking-tighter">Solved</span>
                              <span className="text-xl font-display font-bold text-green-600">{off.solved}</span>
                            </div>
                            <div className="p-3 bg-orange-50 rounded-2xl flex flex-col gap-1">
                              <span className="text-[11px] font-bold text-orange-400 uppercase tracking-tighter">Pending</span>
                              <span className="text-xl font-display font-bold text-orange-600">{off.pending}</span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2">
                             <div className="flex justify-between items-center text-[12px] font-bold text-content-3 uppercase">
                               <span>Efficiency Rate</span>
                               <span>{off.count === 0 ? 0 : Math.round((off.solved / off.count) * 100)}%</span>
                             </div>
                             <div className="h-2 surface-2 rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${off.count === 0 ? 0 : (off.solved / off.count) * 100}%` }}
                                  className="h-full bg-cta rounded-full"
                                ></motion.div>
                             </div>
                          </div>
                          
                          <button
                            onClick={() => setSelectedOfficer(off)}
                            className="w-full py-2 surface-2 border border-[var(--color-border-strong)] rounded-xl text-xs font-bold text-content hover:bg-navy hover:text-white hover:border-cta dark:hover:bg-cta dark:hover:border-cta transition-all"
                          >View Performance Report</button>
                        </TiltCard>
                      ))}
                    </div>
                  </div>
                )}

                {dashboardTab === 'heatmap' && (
                  <div className="flex-1 surface rounded-3xl border border-[var(--color-border)] elev-1 overflow-hidden flex flex-col p-4">
                    <div className="flex items-center justify-between mb-4 px-2">
                       <div className="flex flex-col">
                          <h3 className="font-display font-bold text-content text-sm">Citizen Complaint Heatmap</h3>
                          <p className="text-[12px] font-bold text-content-3 uppercase">Interactive spatial density map</p>
                       </div>
                       <div className="flex gap-4">
                          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500"></div><span className="text-[12px] font-bold text-content-2 uppercase">Critical</span></div>
                          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-orange-500"></div><span className="text-[12px] font-bold text-content-2 uppercase">High</span></div>
                          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-500"></div><span className="text-[12px] font-bold text-content-2 uppercase">Normal</span></div>
                       </div>
                    </div>
                    <div className={`flex-1 rounded-2xl overflow-hidden border border-[var(--color-border)]  relative z-10 shadow-inner map-premium ${isDarkMode ? 'map-dark' : ''}`}>
                      <MapContainer center={[28.6139, 77.2090] as any} zoom={13} style={{ height: '100%', width: '100%' }}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <MapController target={mapFlyTarget} zoom={15} />
                        {complaints.map(c => (
                          <CircleMarker 
                            key={c.id} 
                            center={[c.lat, c.lng]} 
                            radius={8}
                            pathOptions={{ 
                              color: chart.priority[(c.priority as keyof typeof chart.priority)] ?? chart.priority.Medium,
                              fillColor: chart.priority[(c.priority as keyof typeof chart.priority)] ?? chart.priority.Medium,
                              fillOpacity: 0.6
                            }}
                          >
                            <Popup>
                              <div className="p-1">
                                <div className="font-bold text-xs mb-1 font-mono">{c.id}</div>
                                <div className="text-[12px] surface-2 p-2 rounded-lg leading-relaxed">{c.description}</div>
                                <div className="mt-2 text-[12px] font-bold uppercase text-content flex justify-between">
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
                        className="absolute top-3 right-3 z-[500] w-9 h-9 rounded-xl glass-strong border shadow-lg flex items-center justify-center text-content hover:text-cta hover:-translate-y-0.5 transition-all"
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
                variants={VIEW_TRANSITION}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex-1 overflow-y-auto"
              >
                <div className="max-w-4xl mx-auto space-y-8">
                  <div className="text-center py-8">
                    <h2 className="text-3xl font-display font-black text-content mb-2">Live Transparency Feed</h2>
                    <p className="text-content-3">Real-time log of community resolutions and civic progress.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="surface p-6 rounded-3xl border border-[var(--color-border)] elev-1">
                      <div className="text-[12px] font-black text-content-3 uppercase mb-2">Resolved This Week</div>
                      <div className="text-4xl font-display font-bold text-green-500">{stats.resolved + 12}</div>
                    </div>
                    <div className="surface p-6 rounded-3xl border border-[var(--color-border)] elev-1">
                      <div className="text-[12px] font-black text-content-3 uppercase mb-2">Avg. Resolution Speed</div>
                      <div className="text-4xl font-display font-bold text-blue-500">22.4h</div>
                    </div>
                    <div className="surface p-6 rounded-3xl border border-[var(--color-border)] elev-1">
                      <div className="text-[12px] font-black text-content-3 uppercase mb-2">Public Trust Score</div>
                      <div className="text-4xl font-display font-bold text-saffron">98.2%</div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {complaints.filter(c => c.status === 'Resolved' || c.status === 'In Progress').map(c => (
                      <div key={c.id} className="surface p-6 rounded-3xl border border-[var(--color-border)] elev-2 flex gap-6 items-start">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${c.status === 'Resolved' ? 'bg-green-50 text-green-500' : 'bg-blue-50 text-blue-500'}`}>
                          {c.status === 'Resolved' ? <CheckCircle2 size={24} /> : <Clock size={24} />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[12px] font-black text-content-3 uppercase tracking-widest">{c.category} • {c.id}</span>
                            <span className="text-[12px] font-bold text-content surface-2 px-2 py-1 rounded-full">{c.date}</span>
                          </div>
                          <h4 className="font-bold text-content mb-2">{c.description}</h4>
                          <div className="flex items-center gap-4">
                             <div className="flex items-center gap-1.5"><StatusBadge status={c.status} /></div>
                             <div className="text-[12px] font-bold text-content-3 uppercase flex items-center gap-1"><MapPin size={10} /> Delhi, Ward {Math.floor(Math.random() * 50) + 1}</div>
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
                variants={VIEW_TRANSITION}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto w-full gap-8"
              >
                <div className="text-center">
                  <h2 className="font-display font-bold text-3xl">{lang === 'en' ? 'Track Your Complaint' : 'शिकायत ट्रैक करें'}</h2>
                  <p className="text-content-3 mt-2">{lang === 'en' ? 'Enter your ID for live status updates' : 'लाइव अपडेट के लिए अपनी ID दर्ज करें'}</p>
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
                    className="field flex-1 h-14 rounded-2xl border-2 border-[var(--color-border-strong)] surface text-content px-6 font-mono font-bold outline-none"
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
                        <div className="col-span-2 p-6 surface rounded-3xl border border-[var(--color-border)] elev-1 flex flex-col gap-6">
                           <div className="flex justify-between items-start">
                              <div className="flex flex-col gap-1">
                                <span className="text-[12px] font-bold text-content-3 tracking-widest uppercase">Complaint Progress</span>
                                <h3 className="font-display font-bold text-xl">{c.category}</h3>
                              </div>
                              <StatusBadge status={c.status} />
                           </div>

                           <div className="relative pl-8 flex flex-col gap-8">
                             <div className="absolute left-2.5 top-2 bottom-2 w-0.5 surface-2"></div>

                             <TimelineStep done={true} label="Submitted" date={c.date} desc="Issue was successfully logged." />
                             <TimelineStep done={true} label="Under Review" date="Active" desc={`Assigned to ${c.officer}`} />
                             <TimelineStep done={c.status !== 'Pending'} current={c.status === 'In Progress'} label="In Resolution" date="In Progress" desc="Government official is visiting the site." />
                             <TimelineStep done={c.status === 'Resolved'} label="Completed" date="Expected soon" desc="Issue has been fully fixed." />
                           </div>
                        </div>
                     </React.Fragment>
                   ))}
                   {trackSearched && trackId.trim() && !complaints.some(c => c.id === trackId) && (
                     <div className="col-span-2 p-8 surface rounded-3xl border border-dashed border-[var(--color-border-strong)] flex flex-col items-center gap-3 text-center">
                       <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center">
                         <AlertTriangle size={22} />
                       </div>
                       <p className="font-bold text-content">No complaint found</p>
                       <p className="text-sm text-content-3">Double-check the ID — it should look like CIV-20260430-001.</p>
                     </div>
                   )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          </ErrorBoundary>
        </main>

        {/* Right Sidebar - Info/Recent */}
        <aside
          className="hidden xl:flex w-[300px] glass border-l border-[var(--color-border)] flex-col p-6 shrink-0 gap-8 overflow-y-auto"
          aria-label="Summary and recent activity"
        >
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
             <div className="stagger flex-1 overflow-y-auto pr-2 flex flex-col gap-3">
               {complaints.slice(0, 5).map(c => (
                 <div
                   key={c.id}
                   onClick={() => setSelectedComplaint(c)}
                   className="p-3 surface-2 rounded-xl border border-[var(--color-border)] hover:border-saffron dark:hover:border-saffron/50 transition-all cursor-pointer group"
                 >
                   <div className="flex justify-between items-center mb-1">
                     <span className="font-mono text-[12px] font-bold text-content">{c.id}</span>
                     <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c.status === 'Resolved' ? 'bg-green-100 text-green-700  ' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                       {c.status}
                     </span>
                   </div>
                   <p className="text-[11px] text-content-2 font-medium truncate group-hover:text-content transition-colors">{c.description}</p>
                   <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--color-border-strong)]">
                     <span className="text-[11px] text-content-3 flex items-center gap-1 font-bold"><MapPin size={10} /> {c.category}</span>
                     <span className="text-[11px] text-content-3 font-bold italic">{c.date}</span>
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
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0,
                         transition: { type: 'spring', stiffness: 360, damping: 30 } }}
              exit={{ opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.16 } }}
              className="glass-strong rounded-[32px] w-full max-w-xl elev-3 overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="p-8 bg-gradient-to-br from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white flex justify-between items-center relative overflow-hidden">
                <div className="aurora-bg" aria-hidden="true">
                  <div className="aurora-blob w-40 h-40 surface -top-10 -right-10" />
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
                   <DetailField label="User Sentiment" value={<span className="text-sm font-bold capitalize">{selectedComplaint.sentiment || 'Neutral'}</span>} />
                </div>

                <div className="surface-2 p-6 rounded-2xl border border-[var(--color-border)]">
                  <span className="text-[12px] font-bold text-content-3 uppercase tracking-widest block mb-2">Detailed Issue Description</span>
                  <p className="text-sm text-content leading-relaxed italic">{selectedComplaint.description}</p>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-black text-content uppercase tracking-widest flex items-center gap-2">
                    <Stars size={14} className="text-saffron" />
                    AI Suggested Responses
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    {suggestedResponses.length > 0 ? suggestedResponses.map((tpl, i) => (
                      <button
                        key={i}
                        onClick={() => copyToClipboard(tpl)}
                        className="p-3 text-left surface border border-[var(--color-border)] rounded-xl text-xs text-content hover:border-saffron hover:bg-saffron/5 transition-all elev-1 group relative"
                      >
                        <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Download size={12} className="text-saffron" />
                        </div>
                        {tpl}
                      </button>
                    )) : (
                      <SkeletonRegion label="Generating suggested responses">
                        <div className="flex flex-col gap-2">
                          <Skeleton className="h-11 w-full" radius="var(--radius-md)" />
                          <Skeleton className="h-11 w-[88%]" radius="var(--radius-md)" />
                          <Skeleton className="h-11 w-[72%]" radius="var(--radius-md)" />
                        </div>
                      </SkeletonRegion>
                    )}
                  </div>
                </div>

                <div className="flex gap-4 pt-4 border-t border-[var(--color-border)]">
                  <button
                    onClick={() => updateComplaintStatus(selectedComplaint.id, selectedComplaint.status === 'Pending' ? 'In Progress' : 'Resolved')}
                    className="btn-sheen flex-1 h-12 bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:shadow-lg transition-all active:scale-95"
                  >
                    Update Progress <ArrowRight size={18} />
                  </button>
                  <button
                    onClick={() => setSelectedComplaint(null)}
                    className="px-8 h-12 surface-2 text-content-2 rounded-2xl font-bold border border-[var(--color-border-strong)] hover:bg-[var(--color-surface)] hover:border-cta transition-all"
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
              patchComplaint(showFeedbackModal.id, { rating, feedback });
              void rateComplaint(showFeedbackModal.id, rating)
                .catch(err => showToast(err.message || 'Could not save your rating.'));
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

      <MobileNav
        view={view}
        onNavigate={setView}
        pendingCount={stats.pending}
      />

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ y: 40, opacity: 0, scale: 0.94 }}
            animate={{ y: 0, opacity: 1, scale: 1,
                       transition: { type: 'spring', stiffness: 420, damping: 30 } }}
            exit={{ y: 20, opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
            className="fixed left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl elev-4 flex items-center gap-3 glass-strong bordered"
            style={{
              bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
              zIndex: 'var(--z-toast)' as any,
            }}
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

function SidebarItem({ icon, label, active, badge, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`nav-item btn-sheen flex items-center gap-3 px-5 py-3 mx-2 rounded-xl transition-all relative ${
        active
          ? 'bg-gradient-to-r from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white shadow-lg glow-navy'
          : 'text-content-2  hover:bg-[var(--color-surface-2)]  hover:text-cta '
      }`}
    >
      <span className={active ? 'text-saffron-light' : 'text-content-3'}>{icon}</span>
      <span className="text-[13px] font-bold flex-1 text-left">{label}</span>
      {badge ? <span className="bg-gradient-to-br from-saffron to-saffron-bright text-white text-[12px] font-black px-2 py-0.5 rounded-full elev-1">{badge}</span> : null}
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
    <TiltCard maxTilt={6} className="surface p-5 rounded-2xl bordered elev-2 flex flex-col gap-1 transition-shadow hover:elev-3">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-2 ${colors[color]}`} style={{ transform: 'translateZ(20px)' }}>{icon}</div>
      <span className="text-[12px] font-bold text-content-3 uppercase tracking-wider">{label}</span>
      <span className="text-3xl font-display font-bold leading-tight" style={{ transform: 'translateZ(10px)' }}>{value}</span>
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
    <div className="flex items-center justify-between surface-2 p-2.5 rounded-2xl border border-[var(--color-border)]">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center elev-1 ${colors[color]}`}>{icon}</div>
        <span className="text-[11px] font-bold text-content-2">{label}</span>
      </div>
      <span className="text-lg font-display font-bold text-content">{value}</span>
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
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1 rounded-lg border tracking-tight ${config.classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${status === 'In Progress' ? 'animate-pulse' : ''} ${status === 'Emergency' ? 'animate-bounce' : ''}`}></span>
      {status}
    </span>
  );
}

function DetailField({ label, value }: any) {
  return (
    <div className="p-4 surface-2 rounded-xl flex flex-col gap-1">
      <span className="text-[12px] font-bold text-content-3 uppercase tracking-widest">{label}</span>
      <div className="text-sm font-bold text-content">{value}</div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: Complaint['priority'] }) {
  const colors: any = {
    'Low': 'surface-2 text-content-2',
    'Medium': 'bg-blue-50 text-blue-600',
    'High': 'bg-orange-50 text-orange-600',
    'Critical': 'bg-red-50 text-red-600',
  };
  return (
    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md w-fit uppercase ${colors[priority || 'Low']}`}>
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

  if (status === 'Resolved') return <span className="text-[12px] font-bold text-green-500 uppercase">RESOLVED</span>;

  const isOverdue = timeLeft < 0;
  const absTime = Math.abs(timeLeft);
  const hours = Math.floor(absTime / 3600000);
  const minutes = Math.floor((absTime % 3600000) / 60000);
  const seconds = Math.floor((absTime % 60000) / 1000);

  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-mono text-[11px] font-bold border transition-colors ${
      isOverdue ? 'bg-red-50 text-red-600 border-red-200' : 'surface-2 text-content-2 border-[var(--color-border)]'
    }`}>
      <Clock size={12} />
      <span>{isOverdue ? '-' : ''}{String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}</span>
    </div>
  );
}

function TimelineStep({ done, current, label, date, desc }: any) {
  return (
    <div className="relative">
      <div className={`absolute -left-[30px] top-1 w-4 h-4 rounded-full border-4 border-white elev-2 z-10 transition-all ${
        done ? 'bg-cta dark:bg-green-500 scale-110' : current ? 'bg-saffron animate-pulse scale-125' : 'bg-gray-200 '
      }`}></div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
           <span className={`text-sm font-bold ${done ? 'text-content ' : current ? 'text-saffron' : 'text-content-3'}`}>{label}</span>
           <span className="text-[12px] font-bold uppercase text-content-3">{date}</span>
        </div>
        <p className={`text-xs ${done ? 'text-content-2 ' : 'text-content-3 '}`}>{desc}</p>
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
        className="surface rounded-[32px] w-full max-w-sm p-8 elev-3 relative"
      >
        <div className="text-center">
          <div className="w-20 h-20 bg-green-50 text-green-500 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} />
          </div>
          <h3 className="font-display font-bold text-2xl text-content">Resolution Feedback</h3>
          <p className="text-content-3 text-sm mt-2">How was your experience for <span className="font-mono text-content dark:text-saffron font-bold">{complaint.id}</span>?</p>
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
          className="w-full surface-2 border border-[var(--color-border)] rounded-2xl p-4 text-xs h-24 focus:ring-2 focus:ring-cta outline-none resize-none mb-6"
        ></textarea>

        <button 
          onClick={() => onSubmit(rating, feedback)}
          className="w-full h-12 bg-cta dark:bg-saffron text-white rounded-2xl font-bold hover:bg-saffron-bright transition-all"
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
        className="glass-strong rounded-[32px] w-full max-w-md elev-3 overflow-hidden"
      >
        <div className="p-8 bg-gradient-to-br from-navy to-navy-light dark:from-cta dark:to-cta-hover text-white relative overflow-hidden">
          <div className="aurora-bg" aria-hidden="true">
            <div className="aurora-blob w-40 h-40 surface -top-10 -right-10" />
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
            <div className="p-3 surface-2 rounded-2xl flex flex-col gap-1 text-center">
              <span className="text-[11px] font-bold text-content-3 uppercase">Assigned</span>
              <span className="text-2xl font-display font-bold text-content">{officer.count}</span>
            </div>
            <div className="p-3 bg-green-50 rounded-2xl flex flex-col gap-1 text-center">
              <span className="text-[11px] font-bold text-green-500 uppercase">Solved</span>
              <span className="text-2xl font-display font-bold text-green-600">{officer.solved}</span>
            </div>
            <div className="p-3 bg-orange-50 rounded-2xl flex flex-col gap-1 text-center">
              <span className="text-[11px] font-bold text-orange-400 uppercase">Pending</span>
              <span className="text-2xl font-display font-bold text-orange-600">{officer.pending}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center text-[12px] font-bold text-content-3 uppercase">
              <span className="flex items-center gap-1.5"><Gauge size={12} /> Efficiency Rate</span>
              <span>{efficiency}%</span>
            </div>
            <div className="h-2.5 surface-2 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${efficiency}%` }}
                transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
                className="h-full bg-gradient-to-r from-navy to-cta dark:from-cta dark:to-saffron rounded-full"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-yellow-50 rounded-2xl">
            <span className="text-xs font-bold text-content-2 flex items-center gap-2"><Briefcase size={14} /> Citizen Rating</span>
            <span className="text-sm font-bold text-yellow-600 flex items-center gap-1">★ {officer.rating.toFixed(1)} / 5.0</span>
          </div>

          <button
            onClick={onClose}
            className="w-full h-12 surface-2 text-content-2 rounded-2xl font-bold border border-[var(--color-border-strong)] hover:bg-[var(--color-surface)] hover:border-cta transition-all"
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
        className="surface rounded-[32px] w-full max-w-sm p-8 elev-3 overflow-hidden relative"
      >
        <div className="flex justify-between items-center mb-8">
          <div className="flex gap-1">
            {steps.map((_, i) => (i <= step ? <div key={i} className="h-1 w-8 bg-cta dark:bg-saffron rounded-full"></div> : <div key={i} className="h-1 w-2 surface-2 rounded-full"></div>))}
          </div>
          <button onClick={onComplete} className="text-content-3 hover:text-cta transition-colors">✕</button>
        </div>

        <div className="mb-8">
          <div className="w-12 h-12 surface-2 rounded-2xl flex items-center justify-center text-content dark:text-saffron mb-4">
            {steps[step].icon}
          </div>
          <h3 className="font-display font-bold text-2xl text-content">{steps[step].title}</h3>
          <p className="text-content-3 mt-2 leading-relaxed">{steps[step].desc}</p>
        </div>

        <button 
          onClick={() => step < steps.length - 1 ? setStep(step + 1) : onComplete()}
          className="w-full h-12 bg-cta dark:bg-saffron text-white rounded-2xl font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2"
        >
          {step < steps.length - 1 ? "Next" : "Get Started"} <ChevronRight size={18} />
        </button>
      </motion.div>
    </div>
  );
}
