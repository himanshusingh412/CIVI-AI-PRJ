import React from "react";

export interface Complaint {
  id: string;
  category: string;
  department?: string;
  description: string;
  status: 'Pending' | 'In Progress' | 'Resolved' | 'Emergency';
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  // 'Angry' is part of the server-side analysis enum (see /api/analyze-complaint)
  // — it was missing here, so a valid AI response was an unrepresentable state.
  sentiment?: 'Frustrated' | 'Neutral' | 'Polite' | 'Angry';
  escalated?: boolean;
  photoUrl?: string;
  rating?: number;
  feedback?: string;
  officer: string;
  date: string;
  deadline: number; // Timestamp
  timestamp: number;
  lat: number;
  lng: number;
}

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
  read: boolean;
}

export type ViewType = 'chat' | 'dashboard' | 'track' | 'public_feed';
/**
 * Single definition, owned by the i18n layer. This used to be a local
 * `'en' | 'hi'` union, which meant adding a language silently failed to
 * typecheck in every component that had its own copy of the assumption.
 */
export type { LangType } from './i18n/locales';

export interface ChatMessage {
  id: string;
  content: string;
  type: 'bot' | 'user';
  timestamp: string;
}
