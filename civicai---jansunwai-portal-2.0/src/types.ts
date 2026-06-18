/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum Role {
  CITIZEN = 'citizen',
  OFFICER = 'officer',
  ADMIN = 'admin',
}

export enum ComplaintStatus {
  REGISTERED = 'Registered',
  PENDING = 'Pending',
  IN_PROGRESS = 'In Progress',
  RESOLVED = 'Resolved',
  CLOSED = 'Closed',
  ESCALATED_L2 = 'Escalated L2',
  ESCALATED_L3 = 'Escalated L3',
  REOPENED = 'Reopened',
}

export enum Priority {
  URGENT = 'Urgent',
  HIGH = 'High',
  MEDIUM = 'Medium',
  LOW = 'Low',
}

export interface User {
  id: string;
  phone: string;
  name: string;
  role: Role;
  district?: string;
  department?: string;
  createdAt: number;
}

export interface TimelineEntry {
  id: string;
  title: string;
  timestamp: number;
  note: string;
  actor: string;
  actorRole: string;
  type: 'system' | 'officer' | 'citizen' | 'escalation';
}

export interface Complaint {
  id: string;
  citizenId: string;
  citizenPhone: string;
  citizenName: string;
  citizenDistrict: string;
  citizenWard: string;
  category: string;
  subcategory: string;
  description: string;
  priority: Priority;
  status: ComplaintStatus;
  assignedOfficerId?: string;
  assignedOfficerName?: string;
  department: string;
  escalationLevel: number;
  slaDeadline: number;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  attachments: string[];
  timeline: TimelineEntry[];
  feedbackRating?: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  subcategories: string[];
  slaConfig: {
    level1: number; // days
    level2: number;
    level3: number;
  };
}

export interface Notification {
  id: string;
  userId: string;
  message: string;
  type: 'sms' | 'email' | 'push';
  read: boolean;
  createdAt: number;
}
