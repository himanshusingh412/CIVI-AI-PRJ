/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Home, 
  PlusCircle, 
  ClipboardList, 
  User as UserIcon, 
  Bell, 
  LifeBuoy,
  LogOut, 
  Search, 
  Sun, 
  Moon, 
  Menu, 
  X,
  BarChart3,
  ShieldCheck,
  Building2,
  Clock,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Filter,
  Download,
  MessageSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie
} from 'recharts';

import { Role, ComplaintStatus, Priority, User, Complaint, Notification } from './types';
import { DEPARTMENTS, DISTRICTS } from './constants';
import { mockService } from './services/mockService';
import { cn, formatTimestamp } from './lib/utils';
import { AILoader } from './components/AILoader';

import { translations } from './translations';

// --- Components ---

const StatCard = ({ title, value, icon: Icon, color, trend }: any) => (
  <motion.div 
    whileHover={{ y: -4 }}
    className="glass p-6 rounded-2xl flex items-center justify-between overflow-hidden relative"
  >
    <div className="relative z-10">
      <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">{title}</p>
      <h3 className="text-3xl font-bold">{value}</h3>
      {trend && (
        <div className={cn("text-xs mt-2 font-medium flex items-center", trend > 0 ? "text-success" : "text-danger")}>
          {trend > 0 ? '+' : ''}{trend}% from last week
        </div>
      )}
    </div>
    <div className={cn("p-4 rounded-xl relative z-10", color)}>
      <Icon className="w-6 h-6 text-white" />
    </div>
    <div className={cn("absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-10", color)} />
  </motion.div>
);

const Badge = ({ children, status }: { children: React.ReactNode, status: string }) => {
  const getStatusStyles = (s: string) => {
    switch (s) {
      case 'Resolved':
      case 'Closed':
        return 'bg-success/10 text-success border-success/20';
      case 'In Progress':
        return 'bg-primary/10 text-primary border-primary/20';
      case 'Pending':
        return 'bg-warning/10 text-warning border-warning/20';
      case 'Escalated L2':
      case 'Escalated L3':
        return 'bg-danger/10 text-danger border-danger/20';
      case 'Urgent':
        return 'bg-danger text-white border-danger';
      case 'High':
        return 'bg-primary text-white border-primary';
      case 'Medium':
        return 'bg-warning text-white border-warning';
      case 'Low':
        return 'bg-slate-500 text-white border-slate-500';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-semibold border", getStatusStyles(status))}>
      {children}
    </span>
  );
};

// --- Main Views ---

export default function App() {
  const [user, setUser] = useState<User | null>(mockService.getCurrentUser());
  const [view, setView] = useState<'landing' | 'login' | 'dashboard' | 'new-complaint' | 'my-complaints' | 'profile' | 'admin' | 'officer-queue' | 'feedback' | 'reports' | 'support'>('landing');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [language, setLanguage] = useState('English');
  const t = translations[language];
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Initializing Systems...');

  const handleLanguageChange = (lang: string) => {
    performMajorAction(`Translating Interface to ${lang}...`, () => {
      setLanguage(lang);
      localStorage.setItem('lang', lang);
    });
  };

  // Initial Load
  useEffect(() => {
    const startApp = async () => {
      setIsLoading(true);
      setLoadingMessage("Calibrating Secure Interface...");
      
      const savedLang = localStorage.getItem('lang');
      if (savedLang && translations[savedLang]) {
        setLanguage(savedLang);
      }
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        setIsDarkMode(true);
        document.documentElement.classList.add('dark');
      }
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      if (user) {
        setView(user.role === Role.ADMIN ? 'admin' : user.role === Role.OFFICER ? 'officer-queue' : 'dashboard');
        setNotifications(mockService.getNotifications(user.id));
      } else {
        setView('landing');
      }
      setIsLoading(false);
    };

    startApp();
  }, []);

  const performMajorAction = async (msg: string, action: () => void) => {
    setLoadingMessage(msg);
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1800));
    action();
    setIsLoading(false);
  };

  const handleNavigate = (newView: any) => {
    if (newView === view) return;
    performMajorAction(`Switching to ${newView.replace('-', ' ')}...`, () => setView(newView));
  };

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    if (!isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const handleLogin = (phone: string, role: Role) => {
    const newUser = mockService.login(phone, role);
    setUser(newUser);
    setView(role === Role.ADMIN ? 'admin' : role === Role.OFFICER ? 'officer-queue' : 'dashboard');
    setNotifications(mockService.getNotifications(newUser.id));
  };

  const handleLogout = () => {
    mockService.logout();
    setUser(null);
    setView('landing');
    setSelectedComplaint(null);
  };

  // --- Render Functions ---

  if (view === 'landing') {
    return <LandingView t={t} onGetStarted={() => setView('login')} />;
  }

  if (view === 'login') {
    return <LoginView t={t} onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen flex text-slate-900 dark:text-slate-100 font-sans">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-400 transition-transform duration-300 transform",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full",
        "lg:relative lg:translate-x-0"
      )}>
        <div className="h-full flex flex-col p-6">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-primary/20">
              C
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">CIVICAI 2.0</h1>
          </div>

          <nav className="flex-1 space-y-2 overflow-y-auto pr-2 scrollbar-hide">
            {user?.role === Role.CITIZEN && (
              <>
                <NavItem icon={Home} label={t.dashboard} active={view === 'dashboard'} onClick={() => handleNavigate('dashboard')} />
                <NavItem icon={PlusCircle} label={t.newComplaintLabel} active={view === 'new-complaint'} onClick={() => handleNavigate('new-complaint')} />
                <NavItem icon={ClipboardList} label={t.myComplaintsLabel} active={view === 'my-complaints'} onClick={() => handleNavigate('my-complaints')} />
                <NavItem icon={Search} label={t.trackComplaintLabel} active={false} onClick={() => {
                  setIsChatOpen(true);
                  setTimeout(() => {
                    const event = new CustomEvent('chat-command', { detail: 'track' });
                    window.dispatchEvent(event);
                  }, 500);
                }} />
                <div className="h-px bg-white/10 mx-3 my-2" />
                <NavItem icon={UserIcon} label={t.profileLabel} active={view === 'profile'} onClick={() => handleNavigate('profile')} />
                <NavItem icon={Bell} label={t.notificationsLabel} active={false} onClick={() => setShowNotifications(!showNotifications)} badge={notifications.filter(n => !n.read).length.toString()} />
                <div className="h-px bg-white/10 mx-3 my-2" />
                <NavItem icon={MessageSquare} label={t.feedbackLabel} active={view === 'feedback'} onClick={() => handleNavigate('feedback')} />
                <NavItem icon={AlertTriangle} label={t.helpSupportLabel} active={view === 'support'} onClick={() => handleNavigate('support')} />
                <NavItem icon={ShieldCheck} label={t.rtiLabel} active={false} onClick={() => window.open('https://rti.gov.in/', '_blank')} />
                <NavItem icon={BarChart3} label={t.reportsLabel} active={view === 'reports'} onClick={() => handleNavigate('reports')} />
              </>
            )}
            {user?.role === Role.OFFICER && (
              <>
                <NavItem icon={ClipboardList} label={t.workQueue} active={view === 'officer-queue'} onClick={() => setView('officer-queue')} />
                <NavItem icon={BarChart3} label={t.deptAnalytics} active={view === 'dashboard'} onClick={() => setView('dashboard')} />
              </>
            )}
            {user?.role === Role.ADMIN && (
              <>
                <NavItem icon={BarChart3} label={t.systemAnalytics} active={view === 'admin'} onClick={() => setView('admin')} />
                <NavItem icon={Building2} label={t.departments} active={false} onClick={() => {}} />
                <NavItem icon={ShieldCheck} label={t.accessControl} active={false} onClick={() => {}} />
              </>
            )}
            <NavItem icon={UserIcon} label={t.profileLabel} active={view === 'profile'} onClick={() => setView('profile')} />
          </nav>

          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 hover:text-white transition-colors mt-auto"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">{t.logoutLabel}</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-950 overflow-hidden">
        {/* Topbar */}
        <header className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder={t.searchPlaceholder} 
                className="input-field pl-10 w-64 md:w-80 h-10 text-sm"
                value={searchQuery}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const found = mockService.getComplaints().find(c => 
                      c.id.toLowerCase() === searchQuery.toLowerCase() || 
                      c.subcategory.toLowerCase().includes(searchQuery.toLowerCase())
                    );
                    if (found) {
                      setSelectedComplaint(found);
                      setSearchQuery('');
                    } else {
                      performMajorAction("Processing Global Search...", () => alert(`No matches found for "${searchQuery}"`));
                    }
                  }
                }}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={toggleDarkMode}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            
            <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative"
              >
                <Bell className="w-5 h-5" />
                <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-danger rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                  {notifications.filter(n => !n.read).length}
                </span>
              </button>
              
              <AnimatePresence>
                {showNotifications && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 mt-2 w-80 glass rounded-2xl p-4 overflow-hidden z-50 border border-slate-200 dark:border-slate-800 shadow-2xl"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-bold">{t.notifications}</h4>
                      <button 
                        onClick={() => {
                          setNotifications(prev => prev.map(n => ({...n, read: true})));
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        {t.markAllRead}
                      </button>
                    </div>
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                      {notifications.length === 0 ? (
                        <p className="text-slate-500 text-center py-8 text-sm">{t.noNotifications}</p>
                      ) : (
                        notifications.map(n => (
                          <div 
                            key={n.id} 
                            onClick={() => {
                              setNotifications(prev => prev.map(notif => notif.id === n.id ? {...notif, read: true} : notif));
                            }}
                            className={cn(
                              "p-3 rounded-lg transition-colors cursor-pointer group",
                              n.read 
                                ? "bg-slate-100 dark:bg-slate-800/30 opacity-60" 
                                : "bg-primary/5 dark:bg-primary/10 border border-primary/20"
                            )}
                          >
                            <p className="text-sm dark:text-slate-300 leading-snug">{n.message}</p>
                            <span className="text-[10px] text-slate-400 mt-1 block">{formatTimestamp(n.createdAt)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-2" />

            <div className="relative group">
              <button className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-bold uppercase tracking-wider hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <span>{language}</span>
                <ChevronRight className="w-3 h-3 rotate-90" />
              </button>
              <div className="absolute right-0 mt-2 w-32 glass rounded-xl py-2 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all z-50 border border-slate-200 dark:border-slate-800 shadow-xl">
                {['English', 'Hindi', 'Marathi', 'Sanskrit'].map(lang => (
                  <button 
                    key={lang} 
                    onClick={() => handleLanguageChange(lang)}
                    className={cn(
                      "w-full text-left px-4 py-2 text-[10px] font-bold transition-colors",
                      language === lang ? "text-primary bg-primary/5" : "text-slate-500 hover:bg-primary/10 hover:text-primary"
                    )}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-2" />
            
            <div className="relative group">
              <button className="flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-xl transition-colors">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-bold leading-none">{user?.name}</p>
                  <p className="text-[10px] text-slate-500 mt-1 font-bold">CITIZEN</p>
                </div>
                <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-800 ring-2 ring-primary/20 p-0.5">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.name}`} className="w-full h-full rounded-full" alt="profile" />
                </div>
              </button>
              
              <div className="absolute right-0 mt-2 w-48 glass rounded-2xl py-3 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all z-50 border border-slate-200 dark:border-slate-800 shadow-2xl">
                <button onClick={() => setView('profile')} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold hover:bg-primary/5 transition-colors">
                  <UserIcon className="w-4 h-4" /> {t.profileLabel}
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold hover:bg-primary/5 transition-colors">
                  <ShieldCheck className="w-4 h-4" /> {t.security}
                </button>
                <div className="h-px bg-slate-100 dark:bg-slate-800 my-2" />
                <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-danger hover:bg-danger/5 transition-colors">
                  <LogOut className="w-4 h-4" /> {t.signOut}
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {view === 'dashboard' && user?.role === Role.CITIZEN && (
                <CitizenDashboard 
                  t={t}
                  stats={{ total: 5, pending: 2, resolved: 3 }} 
                  onOpenChat={() => setIsChatOpen(true)}
                  onNavigate={handleNavigate}
                  onExport={() => performMajorAction("Architecting Report Data...", () => {
                    const data = mockService.getComplaints();
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `complaints_report_${Date.now()}.json`;
                    a.click();
                  })}
                />
              )}
              {view === 'dashboard' && user?.role === Role.OFFICER && <OfficerDashboard />}
              {view === 'admin' && <AdminDashboard />}
              {view === 'new-complaint' && (
                <NewComplaintForm 
                  t={t}
                  onComplete={() => {
                    performMajorAction("Encrypting & Transmitting Grievance...", () => setView('my-complaints'));
                  }} 
                />
              )}
              {view === 'my-complaints' && <ComplaintListView t={t} onSelect={setSelectedComplaint} role={Role.CITIZEN} />}
              {view === 'officer-queue' && <ComplaintListView t={t} onSelect={setSelectedComplaint} role={Role.OFFICER} />}
              {view === 'profile' && <ProfileView t={t} user={user!} />}
              {view === 'feedback' && <FeedbackView t={t} />}
              {view === 'reports' && <ReportsView t={t} />}
              {view === 'support' && <SupportView t={t} onOpenChat={() => setIsChatOpen(true)} />}
            </motion.div>
          </AnimatePresence>
        </div>

        <AILoader message={loadingMessage} isVisible={isLoading} />
      </main>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedComplaint && (
          <ComplaintDetailView 
            complaint={selectedComplaint} 
            onClose={() => setSelectedComplaint(null)} 
            role={user!.role}
          />
        )}
      </AnimatePresence>

      {/* Floating Chat Widget */}
      <ChatWidget 
        isOpen={isChatOpen} 
        onToggle={() => setIsChatOpen(!isChatOpen)}
        onAction={(actionView) => {
          setView(actionView);
          setIsChatOpen(false);
        }}
        user={user}
      />
    </div>
  );
}

// --- Chat Widget Component ---

interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  timestamp: number;
  options?: string[];
}

const ChatWidget = ({ isOpen, onToggle, onAction, user }: { 
  isOpen: boolean, 
  onToggle: () => void, 
  onAction: (view: any) => void,
  user: User | null
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([
      {
        id: '1',
        role: 'bot',
        text: `Hello! I'm CIVICAI Assistant. How can I help you today?`,
        timestamp: Date.now(),
        options: ['Where is my water supply complaint?', 'File a pothole complaint', 'Talk to an agent']
      }
    ]);
  }, []);

  useEffect(() => {
    const handleCommand = (e: any) => {
      if (e.detail === 'track') {
        handleSend("Track my complaint");
      }
    };
    window.addEventListener('chat-command', handleCommand);
    return () => window.removeEventListener('chat-command', handleCommand);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = (text: string) => {
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Simulate Bot Response with Screenshot Logic
    setTimeout(() => {
      let botResponse: ChatMessage;
      
      if (text.includes('CIV202405160001')) {
        botResponse = {
          id: Date.now().toString(),
          role: 'bot',
          text: "Complaint ID: CIV202405160001\nStatus: In Progress\nDepartment: Jal Jeevan Mission\nLast Update: 15 May 2024\nYour complaint is assigned to a field officer. Expected resolution by 20 May 2024.",
          timestamp: Date.now(),
          options: ['Contact Officer', 'Return to Menu']
        };
      } else if (text.toLowerCase().includes('water supply complaint')) {
        botResponse = {
          id: Date.now().toString(),
          role: 'bot',
          text: "Sure! Please provide your Complaint ID or registered mobile number.",
          timestamp: Date.now()
        };
      } else {
        botResponse = generateBotResponse(text);
      }
      
      setMessages(prev => [...prev, botResponse]);
      setIsTyping(false);
    }, 1200);
  };

  const generateBotResponse = (text: string): ChatMessage => {
    const input = text.toLowerCase();
    let responseText = "I'm not sure how to help with that. Would you like to file a new complaint or track an existing one?";
    let options = ['File a Complaint', 'Track Status', 'Talk to Officer'];
    
    if (input.includes('file') || input.includes('register') || input.includes('new')) {
      responseText = "I can certainly help you file a new complaint. I'll open the form for you right now!";
      setTimeout(() => onAction('new-complaint'), 2000);
      options = [];
    } else if (input.includes('status') || input.includes('track')) {
      responseText = "Please enter your Complaint ID to track status.";
      options = ['Example: CIV202405160001'];
    }

    return {
      id: (Date.now() + 1).toString(),
      role: 'bot',
      text: responseText,
      timestamp: Date.now(),
      options
    };
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9, transformOrigin: 'bottom right' }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="w-full max-w-[380px] sm:w-[400px] glass h-[580px] mb-4 rounded-3xl overflow-hidden shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 bg-[#0a1120]"
          >
            {/* Chat Header */}
            <div className="bg-[#1e2a4a] p-5 text-white flex items-center justify-between shadow-xl">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-xl border border-white/20">
                  <img src="https://api.dicebear.com/7.x/bottts/svg?seed=CivicAI" className="w-8 h-8" alt="bot" />
                </div>
                <div>
                  <h4 className="font-bold text-sm tracking-tight text-white/90">CIVICAI Assistant</h4>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="w-2 h-2 bg-success rounded-full" />
                    <span className="text-[10px] font-bold text-white/60 tracking-wider">Online</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-1.5 hover:bg-white/10 rounded-lg"><Clock className="w-4 h-4 text-white/60" /></button>
                <button className="p-1.5 hover:bg-white/10 rounded-lg"><Sun className="w-4 h-4 text-white/60" /></button>
                <button onClick={onToggle} className="p-1.5 hover:bg-white/10 rounded-lg"><X className="w-4 h-4 text-white/60" /></button>
              </div>
            </div>

            {/* Chat Messages */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-5 space-y-6 bg-slate-950/20"
            >
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={cn(
                    "flex flex-col max-w-[85%] relative",
                    msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                  )}
                >
                  <div className={cn(
                    "p-4 rounded-2xl text-xs leading-relaxed font-medium shadow-xl",
                    msg.role === 'user' 
                      ? "bg-primary text-white rounded-tr-none shadow-primary/20" 
                      : "bg-[#1e2a4a] text-white/90 rounded-tl-none border border-white/5"
                  )}>
                    <div className="whitespace-pre-line">{msg.text}</div>
                  </div>
                  
                  {msg.options && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4 w-full">
                      {msg.options.map(opt => (
                        <button 
                          key={opt}
                          onClick={() => handleSend(opt)}
                          className="px-4 py-2.5 bg-transparent border border-white/10 rounded-xl text-[10px] font-bold text-white/70 hover:bg-white/5 hover:border-white/20 transition-all text-left truncate"
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                  
                  <span className="text-[9px] text-slate-500 mt-2 font-bold uppercase tracking-widest">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>

            {/* Chat Input */}
            <form 
              onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
              className="p-5 bg-slate-900/50 border-t border-white/5 flex gap-3"
            >
              <input 
                type="text" 
                placeholder="Type your message..."
                className="flex-1 bg-transparent border-none px-0 text-sm outline-none text-white placeholder-slate-500 font-medium"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button 
                type="submit"
                className="p-2 text-primary hover:text-primary-dark transition-colors"
                disabled={!input.trim()}
              >
                <div className="rotate-[-45deg]"><MessageSquare className="w-5 h-5" /></div>
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button 
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onToggle}
        className={cn(
          "w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300",
          isOpen ? "bg-slate-800 rotate-90" : "bg-primary"
        )}
      >
        {isOpen ? <X className="w-6 h-6 text-white" /> : <MessageSquare className="w-6 h-6 text-white" />}
      </motion.button>
    </div>
  );
};

// --- Sub-Components ---

const NavItem = ({ icon: Icon, label, active, onClick, badge }: any) => (
  <button 
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group text-slate-400 font-medium",
      active 
        ? "bg-primary text-white shadow-lg shadow-primary/30" 
        : "hover:bg-white/5 hover:text-white"
    )}
  >
    <Icon className={cn("w-5 h-5", active ? "text-white" : "group-hover:text-primary")} />
    <span className="tracking-wide text-sm">{label}</span>
    {badge && (
      <span className="ml-auto bg-danger text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
        {badge}
      </span>
    )}
    {!badge && active && <ChevronRight className="w-4 h-4 ml-auto" />}
  </button>
);

// --- Login View ---

const LoginView = ({ t, onLogin }: { t: any, onLogin: (p: string, r: Role) => void }) => {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [role, setRole] = useState<Role>(Role.CITIZEN);
  const [step, setStep] = useState(1);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden">
       {/* Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_0%,_rgba(var(--primary-rgb),0.15),transparent_50%)] pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/20 rounded-full blur-3xl pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-dark w-full max-w-md p-10 rounded-[40px] border border-white/10 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] relative z-10"
      >
        <div className="text-center mb-8">
          <motion.div 
            whileHover={{ rotate: [0, -10, 10, 0] }}
            className="w-16 h-16 bg-primary rounded-2xl mx-auto flex items-center justify-center text-white font-bold text-3xl mb-4 shadow-2xl shadow-primary/40"
          >
            C
          </motion.div>
          <h2 className="text-3xl font-black tracking-tight mb-2 text-white">{t.loginTitle}</h2>
          <p className="text-slate-400 text-sm font-medium">{t.loginSubTitle}</p>
        </div>

        <div className="flex p-1 bg-slate-800/50 rounded-xl mb-8">
          {(Object.keys(Role) as Array<keyof typeof Role>).map((key) => (
            <button
              key={key}
              onClick={() => setRole(Role[key])}
              className={cn(
                "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                role === Role[key] ? "bg-white text-slate-900 shadow-md" : "text-slate-400 hover:text-slate-200"
              )}
            >
              {key}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div 
              key="step1"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              <div className="text-center mb-4 text-xs text-slate-400 leading-snug">
                {t.loginDesc}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">{t.mobileNumber}</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-medium">+91</span>
                  <input 
                    type="tel" 
                    placeholder="12345 67890" 
                    className="input-field pl-14 h-12"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  />
                </div>
              </div>
              <button 
                onClick={() => phone.length === 10 && setStep(2)}
                disabled={phone.length !== 10}
                className="w-full py-4 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-all disabled:opacity-50 shadow-lg shadow-primary/30"
              >
                {t.loginOtp}
              </button>
            </motion.div>
          ) : (
            <motion.div 
              key="step2"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              <div className="text-center mb-4">
                <h3 className="text-lg font-bold text-white mb-1">{t.otpTitle}</h3>
                <p className="text-xs text-slate-400">{t.otpDesc}</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Enter 6-digit OTP</label>
                <input 
                  type="text" 
                  placeholder="0 0 0 0 0 0" 
                  className="input-field h-12 text-center text-xl tracking-[0.5em] font-bold"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
              <button 
                onClick={() => onLogin(phone, role)}
                className="w-full py-4 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-all shadow-lg shadow-primary/30"
              >
                {t.verifyOtp}
              </button>
              <button 
                onClick={() => setStep(1)}
                className="w-full text-slate-500 text-sm hover:text-slate-300 transition-colors"
              >
                {t.goBack}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-center text-xs text-slate-600 mt-10">
          Secure biometric-ready access powered by Digital India.
        </p>
      </motion.div>
    </div>
  );
};

// --- Sub-Views ---

const CitizenDashboard = ({ t, stats, onOpenChat, onExport, onNavigate }: any) => {
  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-800 dark:text-white">{t.dashboard}</h2>
          <p className="text-slate-500 dark:text-slate-400">{t.welcome}</p>
        </div>
        <div className="flex gap-2">
           <button 
            onClick={onExport}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
           >
            <Download className="w-4 h-4" /> {t.exportReport}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title={t.totalComplaints} value="12" icon={ClipboardList} color="bg-primary" trend={8} />
        <StatCard title={t.inProgress} value="4" icon={Clock} color="bg-orange-500" />
        <StatCard title={t.resolved} value="8" icon={CheckCircle2} color="bg-success" />
        <StatCard title={t.satisfaction} value="84%" icon={ShieldCheck} color="bg-primary" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Activity */}
        <div className="lg:col-span-2 glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold">{t.regTrend}</h3>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-slate-500 font-bold">
                <span className="w-2 h-2 rounded-full bg-primary" /> {t.totalComplaints}
              </span>
            </div>
          </div>
          <div className="h-[250px]">
             <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[
                { name: 'Mon', count: 2 },
                { name: 'Tue', count: 4 },
                { name: 'Wed', count: 3 },
                { name: 'Thu', count: 6 },
                { name: 'Fri', count: 5 },
                { name: 'Sat', count: 8 },
                { name: 'Sun', count: 4 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.1} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10}} />
                <Tooltip 
                  contentStyle={{backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)'}}
                />
                <Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={3} dot={{r: 4, fill: '#2563eb', strokeWidth: 2, stroke: '#fff'}} activeDot={{r: 6}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Complaints by Department */}
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold">{t.deptDist}</h3>
            <button className="text-xs text-primary font-bold hover:underline">View All</button>
          </div>
          <div className="h-[200px] relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Public Works', value: 33 },
                    { name: 'Water Supply', value: 25 },
                    { name: 'Electricity', value: 17 },
                    { name: 'Sanitation', value: 17 },
                    { name: 'Others', value: 8 },
                  ]}
                  innerRadius={55}
                  outerRadius={75}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {['#2563eb', '#059669', '#d97706', '#7c3aed', '#64748b'].map((color, index) => (
                    <Cell key={`cell-${index}`} fill={color} strokeWidth={0} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
              <span className="text-2xl font-black">12</span>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Total</span>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {[
              { name: 'Jal Jeevan Mission', color: '#2563eb', value: '4 (33%)' },
              { name: 'Municipal Corporation', color: '#059669', value: '3 (25%)' },
              { name: 'Public Works Dept.', color: '#d97706', value: '2 (17%)' },
            ].map(item => (
              <div key={item.name} className="flex items-center justify-between text-[10px] font-bold">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{backgroundColor: item.color}} />
                  <span className="text-slate-400">{item.name}</span>
                </div>
                <span>{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Grid */}
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <ActionCard 
            icon={PlusCircle} 
            title={t.fileNewCard} 
            desc={t.fileNewDesc} 
            color="bg-primary"
            onClick={() => onNavigate('new-complaint')}
          />
          <ActionCard 
            icon={Search} 
            title={t.trackCard} 
            desc={t.trackDesc} 
            color="bg-success"
            onClick={() => {
              onOpenChat();
              setTimeout(() => {
                const event = new CustomEvent('chat-command', { detail: 'track' });
                window.dispatchEvent(event);
              }, 500);
            }}
          />
          <ActionCard 
            icon={CheckCircle2} 
            title={t.checkStatusCard} 
            desc={t.checkStatusDesc} 
            color="bg-accent"
            onClick={() => onNavigate('my-complaints')}
          />
          <ActionCard 
            icon={MessageSquare} 
            title={t.contactSupportCard} 
            desc={t.contactSupportDesc} 
            color="bg-warning"
            onClick={() => onOpenChat()}
          />
        </div>
      </div>
    </div>
  );
};

const ActionCard = ({ icon: Icon, title, desc, color, onClick }: any) => (
  <motion.button
    whileHover={{ y: -5 }}
    onClick={onClick}
    className="glass p-5 rounded-2xl flex items-center gap-4 text-left group transition-all"
  >
    <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg", color)}>
      <Icon className="w-6 h-6" />
    </div>
    <div>
      <h4 className="font-bold text-sm tracking-tight group-hover:text-primary transition-colors">{title}</h4>
      <p className="text-xs text-slate-500 mt-1">{desc}</p>
    </div>
  </motion.button>
);

const NewComplaintForm = ({ t, onComplete }: { t: any, onComplete: () => void }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    department: '',
    category: '',
    subcategory: '',
    customSubcategory: '',
    description: '',
    district: 'Central',
    ward: 'Ward 12'
  });

  const handleSubmit = async () => {
    setLoading(true);
    // Simulate API
    setTimeout(() => {
      const submissionData = {
        ...formData,
        subcategory: formData.subcategory === 'Others' ? formData.customSubcategory : formData.subcategory
      };
      mockService.saveComplaint(submissionData);
      setLoading(false);
      onComplete();
    }, 1500);
  };

  const selectedDept = DEPARTMENTS.find(d => d.id === formData.department);

  return (
    <div className="max-w-3xl mx-auto py-8">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight mb-2">{t.registerGrievance}</h2>
        <p className="text-slate-500">{t.registerGrievanceDesc}</p>
      </div>

      <div className="flex gap-4 mb-10">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex-1 flex flex-col gap-2">
            <div className={cn("h-1 rounded-full", s <= step ? "bg-primary" : "bg-slate-200 dark:bg-slate-800")} />
            <span className={cn("text-[10px] font-bold uppercase", s <= step ? "text-primary" : "text-slate-400")}>
              {t.step} {s}
            </span>
          </div>
        ))}
      </div>

      <div className="glass p-8 rounded-3xl">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-10}} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">{t.selectDept}</label>
                  <select 
                    className="input-field h-12"
                    value={formData.department}
                    onChange={(e) => setFormData({...formData, department: e.target.value, subcategory: ''})}
                  >
                    <option value="">{t.chooseDept}</option>
                    {DEPARTMENTS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">{t.subCategory}</label>
                  <select 
                    className="input-field h-12"
                    value={formData.subcategory}
                    onChange={(e) => setFormData({...formData, subcategory: e.target.value, customSubcategory: ''})}
                    disabled={!formData.department}
                  >
                    <option value="">{t.selectSubCategory}</option>
                    {selectedDept?.subcategories.map(s => (
                      <option key={s} value={s}>{s === 'Others' ? t.others : s}</option>
                    ))}
                  </select>
                </div>
              </div>

              {formData.subcategory === 'Others' && (
                <motion.div initial={{opacity:0, height: 0}} animate={{opacity:1, height: 'auto'}} className="space-y-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase">{t.customSubcategoryLabel}</label>
                  <input 
                    type="text"
                    className="input-field h-12 px-4 focus:ring-2 focus:ring-primary/20 transition-all"
                    placeholder={t.customSubcategoryPlaceholder}
                    value={formData.customSubcategory}
                    onChange={(e) => setFormData({...formData, customSubcategory: e.target.value})}
                  />
                </motion.div>
              )}

              <button 
                onClick={() => setStep(2)}
                disabled={!formData.department || !formData.subcategory || (formData.subcategory === 'Others' && !formData.customSubcategory)}
                className="btn-primary w-full h-12 font-bold"
              >
                {t.continueDetails}
              </button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-10}} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">{t.describeGrievance}</label>
                <textarea 
                  placeholder={t.describePlaceholder}
                  className="input-field min-h-[150px] py-4"
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                />
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <AlertTriangle className="w-3 h-3 text-warning" /> {t.aiPriorityHint}
                </div>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setStep(1)} className="flex-1 h-12 font-bold border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
                  {t.goBack}
                </button>
                <button 
                  onClick={() => setStep(3)}
                  disabled={formData.description.length < 10}
                  className="flex-[2] btn-primary h-12 font-bold"
                >
                  {t.verifyLocation}
                </button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-10}} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">{t.district}</label>
                  <select className="input-field" value={formData.district} onChange={(e) => setFormData({...formData, district: e.target.value})}>
                    {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">{t.wardZone}</label>
                  <input type="text" className="input-field" value={formData.ward} onChange={(e) => setFormData({...formData, ward: e.target.value})} />
                </div>
              </div>
              
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex gap-4">
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-bold">{t.privacyVerif}</p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {t.privacyDesc}
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <button onClick={() => setStep(2)} className="flex-1 h-12 font-bold border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
                  {t.goBack}
                </button>
                <button 
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-[2] btn-primary h-12 font-bold flex items-center justify-center"
                >
                  {loading ? (
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
                      <Clock className="w-5 h-5" />
                    </motion.div>
                  ) : t.submitGrievance}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const ComplaintListView = ({ t, onSelect, role }: { t: any, onSelect: (c: Complaint) => void, role: Role }) => {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterPriority, setFilterPriority] = useState<string>('All');

  useEffect(() => {
    const list = mockService.getComplaints();
    if (role === Role.OFFICER) {
      const user = mockService.getCurrentUser()!;
      setComplaints(list.filter(c => c.department === user.department));
    } else {
      const user = mockService.getCurrentUser()!;
      setComplaints(list.filter(c => c.citizenId === user.id));
    }
  }, [role]);

  const filtered = complaints.filter(c => 
    (filterStatus === 'All' || c.status === filterStatus) &&
    (filterPriority === 'All' || c.priority === filterPriority)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-3xl font-bold tracking-tight">
          {role === Role.OFFICER ? t.deptQueue : t.myGrievances}
        </h2>
        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
          <select 
            className="input-field h-9 text-xs w-auto min-w-[120px]"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="All">{t.allStatus}</option>
            {Object.values(ComplaintStatus).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select 
            className="input-field h-9 text-xs w-auto min-w-[120px]"
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
          >
            <option value="All">{t.allPriorities}</option>
            {Object.values(Priority).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900">
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 glass rounded-3xl">
          <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-10 h-10 text-slate-400" />
          </div>
          <h3 className="text-xl font-bold">{t.noGrievances}</h3>
          <p className="text-slate-500">{t.adjustFilters}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(c => (
            <motion.div 
              key={c.id} 
              layoutId={c.id}
              onClick={() => onSelect(c) }
              className="glass p-5 rounded-2xl hover:border-primary/40 transition-all cursor-pointer group flex flex-col md:flex-row md:items-center gap-4 border-transparent"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-primary font-mono tracking-wider">{c.id}</span>
                  <Badge status={c.priority}>{c.priority}</Badge>
                  {c.escalationLevel > 1 && <span className="bg-red-500 animate-pulse w-2 h-2 rounded-full" />}
                </div>
                <h4 className="font-bold truncate text-lg group-hover:text-primary transition-colors">{c.subcategory}</h4>
                <p className="text-sm text-slate-500 truncate mt-1">{c.description}</p>
                <div className="flex items-center gap-4 mt-3 text-[11px] text-slate-400 font-medium">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatTimestamp(c.createdAt)}</span>
                  <span className="flex items-center gap-1 uppercase tracking-wider">{DEPARTMENTS.find(d => d.id === c.department)?.name}</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between md:flex-col md:items-end gap-3 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 pt-3 md:pt-0 md:pl-5">
                <Badge status={c.status}>{c.status}</Badge>
                <div className="flex -space-x-2">
                  <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 border-2 border-white dark:border-slate-900 flex items-center justify-center text-[10px] font-bold">
                    {c.citizenName.charAt(0)}
                  </div>
                  {c.assignedOfficerId && (
                    <div className="w-7 h-7 rounded-full bg-primary/20 text-primary border-2 border-white dark:border-slate-900 flex items-center justify-center text-[10px] font-bold">
                      O
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

const ComplaintDetailView = ({ complaint, onClose, role }: { complaint: Complaint, onClose: () => void, role: Role }) => {
  const [status, setStatus] = useState(complaint.status);
  const [note, setNote] = useState('');
  const [updating, setUpdating] = useState(false);

  const handleUpdate = () => {
    setUpdating(true);
    setTimeout(() => {
      mockService.updateComplaintStatus(complaint.id, status, note);
      setUpdating(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }} 
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" 
      />
      
      <motion.div 
        layoutId={complaint.id}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-4xl glass rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row h-[90vh] md:h-auto max-h-[90vh]"
      >
        <div className="absolute top-4 right-4 z-10">
          <button onClick={onClose} className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Side */}
        <div className="flex-1 p-8 overflow-y-auto border-r border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-xs font-bold text-primary">{complaint.id}</span>
            <Badge status={complaint.priority}>{complaint.priority} Priority</Badge>
          </div>
          
          <h3 className="text-2xl font-black mb-4 tracking-tight leading-tight">{complaint.subcategory}</h3>
          
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div className="p-3 bg-slate-100 dark:bg-slate-800/50 rounded-xl">
              <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Status</p>
              <div className="flex items-center gap-2">
                <Badge status={complaint.status}>{complaint.status}</Badge>
              </div>
            </div>
            <div className="p-3 bg-slate-100 dark:bg-slate-800/50 rounded-xl">
              <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Escalation</p>
              <div className="text-sm font-bold flex items-center gap-2">
                Level {complaint.escalationLevel}
                {complaint.escalationLevel > 1 && <AlertTriangle className="w-4 h-4 text-danger animate-pulse" />}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Description</h4>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                {complaint.description}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Citizen Details</h4>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary font-bold text-xl">
                  {complaint.citizenName.charAt(0)}
                </div>
                <div>
                  <p className="font-bold">{complaint.citizenName}</p>
                  <p className="text-xs text-slate-500">{complaint.citizenDistrict} • {complaint.citizenWard}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Timeline/Actions Side */}
        <div className="w-full md:w-96 bg-slate-50/50 dark:bg-slate-900/50 p-8 flex flex-col min-h-0">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Tracking Timeline</h4>
          
          <div className="flex-1 space-y-6 overflow-y-auto pr-2 mb-6 scrollbar-hide">
            {complaint.timeline.map((entry, idx) => (
              <div key={entry.id} className="relative pl-6">
                {idx !== complaint.timeline.length - 1 && (
                  <div className="absolute left-1.5 top-5 h-full w-px bg-slate-200 dark:bg-slate-800" />
                )}
                <div className={cn(
                  "absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-950",
                  entry.type === 'escalation' ? 'bg-danger' : 
                  entry.type === 'officer' ? 'bg-primary' : 
                  entry.type === 'citizen' ? 'bg-accent' : 'bg-success'
                )} />
                <p className="text-[11px] font-bold tracking-tight">{entry.title}</p>
                <p className="text-[10px] text-slate-400 mt-1">{formatTimestamp(entry.timestamp)}</p>
                <p className="text-xs text-slate-500 mt-2 bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-800 italic">
                  "{entry.note}"
                </p>
              </div>
            ))}
          </div>

          {role === Role.OFFICER && complaint.status !== ComplaintStatus.RESOLVED && (
            <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <select className="input-field text-sm" value={status} onChange={(e) => setStatus(e.target.value as ComplaintStatus)}>
                {Object.values(ComplaintStatus).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <textarea 
                placeholder="Action notes..." 
                className="input-field text-sm h-24"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button 
                onClick={handleUpdate}
                disabled={updating || !note}
                className="btn-primary w-full py-3 h-auto font-bold flex items-center justify-center gap-2"
              >
                {updating ? <Clock className="w-4 h-4 animate-spin" /> : "Update Request"}
              </button>
            </div>
          )}

          {role === Role.CITIZEN && complaint.status === ComplaintStatus.RESOLVED && (
            <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <p className="text-sm font-bold text-center">Are you satisfied?</p>
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    mockService.updateComplaintStatus(complaint.id, ComplaintStatus.REOPENED, 'The issue was not resolved satisfactorily.');
                    onClose();
                  }}
                  className="flex-1 py-3 text-xs font-bold rounded-xl border border-danger text-danger hover:bg-danger/10 transition-all"
                >
                  No, Reopen
                </button>
                <button 
                  onClick={() => {
                    mockService.updateComplaintStatus(complaint.id, ComplaintStatus.CLOSED, 'Highly satisfied with the swift resolution.');
                    onClose();
                  }}
                  className="flex-1 py-3 text-xs font-bold rounded-xl bg-success text-white hover:bg-success-dark transition-all"
                >
                  Yes, Close It
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const ProfileView = ({ user, t }: { user: User, t: any }) => (
  <div className="max-w-4xl mx-auto space-y-8">
    <div className="glass rounded-[40px] p-10 overflow-hidden relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      
      <div className="relative z-10 flex flex-col md:flex-row items-center gap-10">
        <div className="w-40 h-40 bg-white dark:bg-slate-900 border-8 border-slate-100 dark:border-slate-800 rounded-3xl flex items-center justify-center text-5xl font-black text-primary shadow-xl">
          {user.name.charAt(0)}
        </div>
        
        <div className="text-center md:text-left flex-1">
          <div className="flex items-center justify-center md:justify-start gap-3 mb-2">
            <h2 className="text-4xl font-black tracking-tight">{user.name}</h2>
            <Badge status="citizen">{user.role.toUpperCase()}</Badge>
          </div>
          <p className="text-slate-500 font-medium mb-6">Registered on {formatTimestamp(user.createdAt)}</p>
          
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-4">
             <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-success" />
              <span className="text-sm font-bold">{t.accountSecurity}</span>
            </div>
            <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold">{user.district} {t.district}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="glass rounded-3xl p-8">
        <h4 className="text-lg font-bold mb-6">{t.personalInfo}</h4>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t.mobileNumber}</span>
            <span className="font-mono font-bold">+91 {user.phone}</span>
          </div>
          <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Digital ID</span>
            <span className="font-mono font-bold">{user.id}</span>
          </div>
        </div>
      </div>
      
      <div className="glass rounded-3xl p-8 bg-accent/5">
        <h4 className="text-lg font-bold mb-6">{t.security}</h4>
        <div className="space-y-3">
          <button className="w-full flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-950 hover:border-accent transition-all text-sm font-bold">
            Two-Factor Auth <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>
          <button className="w-full flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-950 hover:border-accent transition-all text-sm font-bold">
            Data Export & GDPR <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>
          <button className="w-full flex items-center justify-between p-4 rounded-2xl bg-slate-100 dark:bg-slate-950 opacity-50 cursor-not-allowed text-sm font-bold">
            {t.profileLabel} <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>
    </div>
  </div>
);

const AdminDashboard = () => {
  const [activeDept, setActiveDept] = useState(DEPARTMENTS[0].id);
  const [stats, setStats] = useState({
     total: 1240,
     resolved: 980,
     escalated: 12,
     avgSla: '4.2 Days'
  });

  const deptData = DEPARTMENTS.map(d => ({
    name: d.code,
    complaints: Math.floor(Math.random() * 100) + 20,
    resolved: Math.floor(Math.random() * 80) + 10
  }));

  const COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626'];

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black tracking-tight">System Authority Control</h2>
          <p className="text-slate-500 font-medium">Real-time health monitoring of all departments.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => {
              mockService.simulateTimePassage(1);
              window.location.reload();
            }}
            className="flex items-center gap-2 px-6 py-3 bg-warning text-white rounded-2xl font-bold shadow-xl shadow-warning/20 active:scale-95 transition-all"
          >
            <Clock className="w-5 h-5" /> Simulate Day Pass
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="System-wide Complaints" value={stats.total} icon={ClipboardList} color="bg-primary" trend={12} />
        <StatCard title="Total Resolved" value={stats.resolved} icon={CheckCircle2} color="bg-success" trend={4} />
        <StatCard title="Escalation Alerts" value={stats.escalated} icon={AlertTriangle} color="bg-danger" />
        <StatCard title="Avg. Resolution" value={stats.avgSla} icon={Clock} color="bg-accent" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 glass rounded-[32px] p-8">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h3 className="text-xl font-bold">Department Efficiency</h3>
              <p className="text-sm text-slate-500">Comparing load vs. resolution capacity</p>
            </div>
          </div>
          <div className="h-[400px]">
             <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <Tooltip 
                  cursor={{fill: 'rgba(37, 99, 235, 0.05)'}}
                  contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                />
                <Bar dataKey="complaints" fill="#2563eb" radius={[6, 6, 0, 0]} barSize={24} />
                <Bar dataKey="resolved" fill="#059669" radius={[6, 6, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass rounded-[32px] p-8">
          <h3 className="text-xl font-bold mb-10 text-center">Priority Distribution</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Urgent', value: 15 },
                    { name: 'High', value: 30 },
                    { name: 'Medium', value: 45 },
                    { name: 'Low', value: 10 },
                  ]}
                  innerRadius={80}
                  outerRadius={110}
                  paddingAngle={8}
                  dataKey="value"
                >
                  {[0, 1, 2, 3].map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-8">
            {['Urgent', 'High', 'Medium', 'Low'].map((label, idx) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{backgroundColor: COLORS[idx]}} />
                <span className="text-xs font-bold">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const SupportView = ({ onOpenChat, t }: { onOpenChat: () => void, t: any }) => (
  <div className="max-w-4xl mx-auto space-y-8">
    <div className="text-center mb-12">
      <h2 className="text-4xl font-black tracking-tight mb-4">{t.helpSupportLabel}</h2>
      <p className="text-slate-500 max-w-2xl mx-auto">Access our 24/7 support resources, documentations, and direct contact channels for immediate assistance.</p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {[
        { title: 'Chat with AI', desc: 'Instant answers to common queries and complaint tracking.', icon: MessageSquare, action: onOpenChat },
        { title: 'Technical Support', desc: 'Email our developers for app-related technical issues.', icon: LifeBuoy, action: () => alert('Contacting tech support...') },
        { title: 'Emergency Helpline', desc: 'Call our emergency response team for critical issues.', icon: AlertTriangle, action: () => alert('Calling helpline...') }
      ].map((item, idx) => (
        <div key={idx} className="glass p-8 rounded-3xl text-center flex flex-col items-center">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mb-6">
            <item.icon className="w-8 h-8" />
          </div>
          <h4 className="text-lg font-bold mb-3">{item.title}</h4>
          <p className="text-sm text-slate-500 mb-6">{item.desc}</p>
          <button onClick={item.action} className="btn-primary w-full py-3 h-auto">Get Started</button>
        </div>
      ))}
    </div>

    <div className="glass rounded-3xl p-10 mt-12 bg-slate-900 border-none">
      <h3 className="text-2xl font-bold text-white mb-6">Frequently Asked Questions</h3>
      <div className="space-y-4">
        {[
          "How long does it take to resolve a complaint?",
          "Can I withdraw a registered grievance?",
          "How do I escalate my issue further?",
          "What is the Digital ID used for?"
        ].map((q, idx) => (
          <div key={idx} className="flex items-center justify-between p-5 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 cursor-pointer group">
            <span className="text-white text-sm font-medium">{q}</span>
            <ChevronRight className="w-4 h-4 text-white/40 group-hover:text-white transition-colors" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

const FeedbackView = ({ t }: { t: any }) => (
  <div className="max-w-2xl mx-auto py-12">
    <div className="text-center mb-10">
      <h2 className="text-4xl font-black tracking-tight mb-4 text-slate-800 dark:text-white">{t.feedbackLabel}</h2>
      <p className="text-slate-500">Your experience helps us improve the civic infrastructure for everyone.</p>
    </div>

    <div className="glass rounded-[40px] p-10 space-y-8">
      <div>
        <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Rate the Portal</label>
        <div className="flex justify-between">
          {[1, 2, 3, 4, 5].map(star => (
            <button key={star} className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xl hover:bg-primary hover:text-white transition-all transform hover:scale-110">
              <Sun className="w-6 h-6" />
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Which department performed best?</label>
        <div className="grid grid-cols-2 gap-3">
          {DEPARTMENTS.slice(0, 4).map(d => (
            <button key={d.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-left text-sm font-bold hover:border-primary transition-all">
              {d.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Additional Comments</label>
        <textarea className="input-field min-h-[120px] py-4" placeholder="How can we make your experience better?" />
      </div>

      <button onClick={() => alert("Thank you for your feedback!")} className="btn-primary w-full py-4 h-auto font-black text-lg shadow-xl shadow-primary/30">
        Submit Feedback
      </button>
    </div>
  </div>
);

const ReportsView = ({ t }: { t: any }) => (
  <div className="space-y-10">
    <div className="flex flex-col md:flex-row items-center justify-between gap-6">
      <div>
        <h2 className="text-4xl font-black tracking-tight text-slate-800 dark:text-white text-center md:text-left">{t.reportsLabel}</h2>
        <p className="text-slate-500 font-medium text-center md:text-left">Detailed insights into your grievance history and resolution patterns.</p>
      </div>
      <button className="btn-primary flex items-center gap-2 px-8 py-4 h-auto font-bold shadow-2xl shadow-primary/20">
        <Download className="w-5 h-5" /> {t.exportReport}
      </button>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="glass p-8 rounded-[32px]">
        <h4 className="text-xl font-bold mb-8">Monthly Status Distribution</h4>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[
              { name: 'Jan', res: 4, pend: 2 },
              { name: 'Feb', res: 5, pend: 1 },
              { name: 'Mar', res: 8, pend: 0 },
              { name: 'Apr', res: 3, pend: 4 },
            ]}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="res" fill="#059669" radius={[4, 4, 0, 0]} />
              <Bar dataKey="pend" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="glass p-8 rounded-[32px]">
        <h4 className="text-xl font-bold mb-8">Resolution Time Efficiency</h4>
        <div className="space-y-6">
          {[
            { label: 'Water Supply', val: 85, color: 'bg-primary' },
            { label: 'Electricity', val: 92, color: 'bg-success' },
            { label: 'Sanitation', val: 64, color: 'bg-warning' },
            { label: 'Public Works', val: 45, color: 'bg-danger' },
          ].map(item => (
            <div key={item.label}>
              <div className="flex justify-between text-xs font-bold mb-2">
                <span className="uppercase tracking-widest text-slate-500">{item.label}</span>
                <span>{item.val}% SLA Met</span>
              </div>
              <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${item.val}%` }}
                  className={cn("h-full", item.color)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const OfficerDashboard = () => {
  const deptId = mockService.getCurrentUser()?.department;
  const dept = DEPARTMENTS.find(d => d.id === deptId);

  return (
    <div className="space-y-8">
       <div>
        <h2 className="text-3xl font-black tracking-tight">{dept?.name} Portal</h2>
        <p className="text-slate-500 font-medium tracking-tight">Mission critical task queue for your department.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="Active Grievances" value="42" icon={ClipboardList} color="bg-primary" />
        <StatCard title="Breaching SLA" value="7" icon={AlertTriangle} color="bg-danger" />
        <StatCard title="Avg Time to Response" value="1.4h" icon={Clock} color="bg-success" />
      </div>

       <div className="glass rounded-3xl p-8 bg-slate-900 border-none relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-8 opacity-10 blur-sm group-hover:scale-110 transition-transform duration-500">
          <Building2 className="w-64 h-64 text-white" />
        </div>
        <div className="relative z-10 max-w-xl">
          <h3 className="text-2xl font-bold text-white mb-4">Department Protocols</h3>
          <p className="text-slate-400 mb-6 leading-relaxed">
            All Level 1 grievances must be acknowledged within 24 hours. Critical priority infrastructure issues take precedence over billing enquiries.
          </p>
          <div className="flex gap-4">
            <div className="bg-white/5 p-4 rounded-2xl border border-white/10 flex-1">
              <p className="text-xs font-bold text-slate-500 uppercase mb-1">Target SLA</p>
              <p className="text-lg font-black text-white">{dept?.slaConfig.level1} Days</p>
            </div>
            <div className="bg-white/5 p-4 rounded-2xl border border-white/10 flex-1">
              <p className="text-xs font-bold text-slate-500 uppercase mb-1">Queue Load</p>
              <p className="text-lg font-black text-white">Moderate</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Landing View ---

const LandingView = ({ t, onGetStarted }: { t: any, onGetStarted: () => void }) => {
  return (
    <div className="min-h-screen bg-slate-950 text-white overflow-hidden selection:bg-primary/30">
      {/* Dynamic Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,_rgba(var(--primary-rgb),0.15),transparent_70%)]" />
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
            x: [0, 50, 0],
            y: [0, -30, 0]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/4 -left-20 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px]" 
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.3, 1],
            opacity: [0.2, 0.4, 0.2],
            x: [0, -40, 0],
            y: [0, 60, 0]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-1/4 -right-20 w-[500px] h-[500px] bg-accent/20 rounded-full blur-[100px]" 
        />
      </div>

      <nav className="relative z-50 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-primary/40">
            C
          </div>
          <span className="text-xl font-black tracking-tight uppercase">CIVICAI 2.0</span>
        </div>
        <div className="flex items-center gap-8">
          <button onClick={onGetStarted} className="text-sm font-bold hover:text-primary transition-colors">{t.loginOtp}</button>
          <button 
            onClick={onGetStarted}
            className="px-6 py-2.5 bg-primary rounded-full text-sm font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
          >
            {t.getStarted}
          </button>
        </div>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-8 pt-20 pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black uppercase tracking-wider mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Live Deployment: v2.0.4-LTS
            </div>
            <h1 className="text-7xl xl:text-8xl font-black leading-[0.9] mb-8">
              {t.heroTitle}<br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                {t.heroTitleAccent}
              </span>
            </h1>
            <p className="text-slate-400 text-lg md:text-xl max-w-xl leading-relaxed mb-10">
              {t.heroSubtitle}
            </p>
            <div className="flex flex-wrap gap-4">
              <button 
                onClick={onGetStarted}
                className="group relative px-10 py-5 bg-primary rounded-2xl font-black text-lg overflow-hidden transition-all shadow-2xl shadow-primary/30"
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative z-10 flex items-center gap-2">
                  {t.getStarted} <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
              <button className="px-10 py-5 border border-white/10 rounded-2xl font-black text-lg hover:bg-white/5 transition-all">
                {t.learnMore}
              </button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.8, rotateY: -20 }}
            animate={{ opacity: 1, scale: 1, rotateY: 0 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            className="hidden lg:block perspective-2000"
          >
            <div className="relative group">
              {/* 3D Dashboard Mockup */}
              <motion.div 
                animate={{ 
                  y: [0, -15, 0],
                  rotateX: [2, -2, 2],
                  rotateY: [1, -1, 1]
                }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                className="glass-dark p-4 rounded-[40px] border border-white/10 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] transform-style-3d overflow-hidden"
              >
                <div className="bg-slate-950/80 rounded-[30px] p-6 h-[500px] border border-white/5 overflow-hidden">
                   <div className="flex items-center justify-between mb-8">
                      <div className="flex gap-2">
                        <div className="w-3 h-3 rounded-full bg-danger/50" />
                        <div className="w-3 h-3 rounded-full bg-warning/50" />
                        <div className="w-3 h-3 rounded-full bg-success/50" />
                      </div>
                      <div className="h-4 w-32 bg-white/5 rounded-full" />
                   </div>
                   <div className="grid grid-cols-2 gap-4 mb-8">
                      <div className="h-24 bg-primary/10 rounded-2xl border border-primary/20 p-4">
                        <div className="h-2 w-12 bg-primary/30 rounded-full mb-3" />
                        <div className="h-6 w-20 bg-white/20 rounded-full" />
                      </div>
                      <div className="h-24 bg-white/5 rounded-2xl border border-white/10 p-4">
                        <div className="h-2 w-12 bg-white/10 rounded-full mb-3" />
                        <div className="h-6 w-16 bg-white/20 rounded-full" />
                      </div>
                   </div>
                   <div className="space-y-4">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="flex gap-4 items-center bg-white/5 p-4 rounded-xl border border-white/5">
                           <div className="w-10 h-10 bg-white/10 rounded-lg" />
                           <div className="flex-1 space-y-2">
                              <div className="h-2 w-full bg-white/10 rounded-full" />
                              <div className="h-2 w-2/3 bg-white/5 rounded-full" />
                           </div>
                        </div>
                      ))}
                   </div>
                </div>
              </motion.div>

              {/* Floating Elements for depth */}
              <motion.div 
                animate={{ y: [0, 20, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                className="absolute -top-10 -right-10 w-32 h-32 glass rounded-3xl flex items-center justify-center shadow-2xl z-20 backdrop-blur-xl border border-white/20"
              >
                <div className="text-center">
                  <div className="text-primary text-2xl font-black">98%</div>
                  <div className="text-slate-500 text-[8px] font-bold uppercase tracking-tighter">Resolution</div>
                </div>
              </motion.div>

              <motion.div 
                animate={{ y: [0, -20, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                className="absolute -bottom-10 -left-10 px-6 py-4 glass rounded-2xl shadow-2xl z-20 backdrop-blur-xl border border-white/20 flex items-center gap-3"
              >
                <div className="w-8 h-8 bg-success rounded-full flex items-center justify-center text-white">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white leading-none mb-1">Aadhar Verified</div>
                  <div className="text-[8px] text-slate-500 font-bold uppercase">Identity Secure</div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-40">
          {[
            { title: t.feature1Title, desc: t.feature1Desc, icon: MessageSquare, color: "text-primary" },
            { title: t.feature2Title, desc: t.feature2Desc, icon: ShieldCheck, color: "text-accent" },
            { title: t.feature3Title, desc: t.feature3Desc, icon: Clock, color: "text-success" }
          ].map((f, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
              className="glass-dark p-8 rounded-[32px] border border-white/10 hover:border-white/20 transition-all hover:bg-white/[0.03]"
            >
              <div className={cn("w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center mb-6", f.color)}>
                <f.icon className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-bold mb-4">{f.title}</h3>
              <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/10 py-12 px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">© 2024 CIVICAI TECHNOLOGY LABS. NATIONAL ARCHIVE ENCRYPTED.</p>
          <div className="flex gap-8">
            <a href="#" className="text-xs text-slate-500 hover:text-white transition-colors font-bold uppercase tracking-widest">Privacy Protocol</a>
            <a href="#" className="text-xs text-slate-500 hover:text-white transition-colors font-bold uppercase tracking-widest">Security Audit</a>
            <a href="#" className="text-xs text-slate-500 hover:text-white transition-colors font-bold uppercase tracking-widest">SLA Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
