/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Complaint,
  ComplaintStatus,
  Notification,
  Priority,
  Role,
  TimelineEntry,
  User,
} from '../types';
import { DEPARTMENTS, PRIORITY_KEYWORDS, STORAGE_KEYS } from '../constants';
import { generateId } from '../lib/utils';

export const mockService = {
  // --- Auth ---
  login: (phone: string, role: Role): User => {
    const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
    let user = users.find((u: User) => u.phone === phone && u.role === role);

    if (!user) {
      user = {
        id: generateId(),
        phone,
        name: role === Role.CITIZEN ? `Citizen ${phone.slice(-4)}` : `${role.charAt(0).toUpperCase() + role.slice(1)} ${generateId()}`,
        role,
        district: 'Central',
        createdAt: Date.now(),
      };
      if (role === Role.OFFICER) {
        user.department = DEPARTMENTS[Math.floor(Math.random() * DEPARTMENTS.length)].id;
      }
      users.push(user);
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    }

    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(user));
    return user;
  },

  logout: () => {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
  },

  getCurrentUser: (): User | null => {
    const session = localStorage.getItem(STORAGE_KEYS.SESSION);
    return session ? JSON.parse(session) : null;
  },

  // --- Complaints ---
  getComplaints: (): Complaint[] => {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPLAINTS) || '[]');
  },

  saveComplaint: (data: Partial<Complaint>): Complaint => {
    const complaints = mockService.getComplaints();
    const user = mockService.getCurrentUser()!;

    // AI Priority Detection
    const description = data.description?.toLowerCase() || '';
    let priority = Priority.LOW;
    if (PRIORITY_KEYWORDS[Priority.URGENT].some(word => description.includes(word))) {
      priority = Priority.URGENT;
    } else if (PRIORITY_KEYWORDS[Priority.HIGH].some(word => description.includes(word))) {
      priority = Priority.HIGH;
    } else if (PRIORITY_KEYWORDS[Priority.MEDIUM].some(word => description.includes(word))) {
      priority = Priority.MEDIUM;
    }

    const dept = DEPARTMENTS.find(d => d.id === data.department);
    const slaDays = dept?.slaConfig.level1 || 3;

    const newComplaint: Complaint = {
      id: `COMP-${generateId()}`,
      citizenId: user.id,
      citizenPhone: user.phone,
      citizenName: user.name,
      citizenDistrict: user.district || 'Central',
      citizenWard: 'Ward 12',
      category: data.category || 'General',
      subcategory: data.subcategory || 'Miscellaneous',
      description: data.description || '',
      priority,
      status: ComplaintStatus.REGISTERED,
      department: data.department || DEPARTMENTS[0].id,
      escalationLevel: 1,
      slaDeadline: Date.now() + slaDays * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attachments: [],
      timeline: [
        {
          id: generateId(),
          title: 'Complaint Registered',
          timestamp: Date.now(),
          note: 'Your complaint has been successfully registered in the system.',
          actor: 'System',
          actorRole: 'System',
          type: 'system',
        },
      ],
      ...data,
    };

    complaints.unshift(newComplaint);
    localStorage.setItem(STORAGE_KEYS.COMPLAINTS, JSON.stringify(complaints));
    
    mockService.addNotification(
      user.id,
      `Your complaint ${newComplaint.id} has been registered.`,
      'push'
    );

    return newComplaint;
  },

  updateComplaintStatus: (id: string, status: ComplaintStatus, note: string): Complaint | null => {
    const complaints = mockService.getComplaints();
    const user = mockService.getCurrentUser()!;
    const index = complaints.findIndex(c => c.id === id);

    if (index === -1) return null;

    const complaint = complaints[index];
    const oldStatus = complaint.status;
    complaint.status = status;
    complaint.updatedAt = Date.now();
    
    if (status === ComplaintStatus.RESOLVED) {
      complaint.resolvedAt = Date.now();
    }

    complaint.timeline.push({
      id: generateId(),
      title: `Status updated to ${status}`,
      timestamp: Date.now(),
      note,
      actor: user.name,
      actorRole: user.role,
      type: user.role === Role.OFFICER ? 'officer' : 'citizen',
    });

    localStorage.setItem(STORAGE_KEYS.COMPLAINTS, JSON.stringify(complaints));

    mockService.addNotification(
      complaint.citizenId,
      `Your complaint ${complaint.id} status changed: ${oldStatus} → ${status}`,
      'sms'
    );

    return complaint;
  },

  // --- SLA & Time Travel Simulation ---
  simulateTimePassage: (days: number) => {
    const complaints = mockService.getComplaints();
    const now = Date.now();
    const timeShift = days * 24 * 60 * 60 * 1000;
    let changed = false;

    complaints.forEach(c => {
      if (c.status === ComplaintStatus.RESOLVED || c.status === ComplaintStatus.CLOSED) return;

      const effectiveDeadline = c.slaDeadline;
      
      if (now > effectiveDeadline) {
        if (c.escalationLevel < 3) {
          c.escalationLevel += 1;
          const dept = DEPARTMENTS.find(d => d.id === c.department)!;
          const nextSlaDays = c.escalationLevel === 2 ? dept.slaConfig.level2 : dept.slaConfig.level3;
          c.slaDeadline = now + nextSlaDays * 24 * 60 * 60 * 1000;
          c.status = c.escalationLevel === 2 ? ComplaintStatus.ESCALATED_L2 : ComplaintStatus.ESCALATED_L3;
          
          c.timeline.push({
            id: generateId(),
            title: `Auto-Escalated to Level ${c.escalationLevel}`,
            timestamp: now,
            note: `Complaint breached SLA and has been automatically escalated.`,
            actor: 'SLA Engine',
            actorRole: 'System',
            type: 'escalation',
          });
          
          mockService.addNotification(
            c.citizenId,
            `Alert: Your complaint ${c.id} has been escalated to Level ${c.escalationLevel} due to delay.`,
            'push'
          );
          
          changed = true;
        }
      }
    });

    if (changed) {
      localStorage.setItem(STORAGE_KEYS.COMPLAINTS, JSON.stringify(complaints));
    }
    return changed;
  },

  // --- Notifications ---
  getNotifications: (userId: string): Notification[] => {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS) || '[]');
    return all.filter((n: Notification) => n.userId === userId);
  },

  addNotification: (userId: string, message: string, type: 'sms' | 'email' | 'push') => {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS) || '[]');
    all.unshift({
      id: generateId(),
      userId,
      message,
      type,
      read: false,
      createdAt: Date.now(),
    });
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(all));
  },
};
