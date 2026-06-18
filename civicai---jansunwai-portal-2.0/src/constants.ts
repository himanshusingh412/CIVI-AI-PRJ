/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Department, Priority } from './types';

export const DEPARTMENTS: Department[] = [
  {
    id: 'dept_water',
    name: 'Water Supply',
    code: 'WS',
    subcategories: ["No Water Supply", "Leakage Issue", "Low Pressure", "Dirty Water", "Others"],
    slaConfig: { level1: 2, level2: 5, level3: 10 },
  },
  {
    id: 'dept_elec',
    name: 'Electricity',
    code: 'ELEC',
    subcategories: ["Power Cut", "Voltage Issue", "Street Light Not Working", "Billing Issue", "Others"],
    slaConfig: { level1: 1, level2: 3, level3: 7 },
  },
  {
    id: 'dept_san',
    name: 'Sanitation',
    code: 'SAN',
    subcategories: ["Garbage Not Collected", "Drainage Problem", "Public Toilet Issue", "Sewage Overflow", "Others"],
    slaConfig: { level1: 1, level2: 4, level3: 8 },
  },
  {
    id: 'dept_roads',
    name: 'Roads & Transport',
    code: 'ROAD',
    subcategories: ["Potholes", "Road Damage", "Traffic Signal Issue", "Street Sign Missing", "Others"],
    slaConfig: { level1: 3, level2: 7, level3: 15 },
  },
  {
    id: 'dept_safety',
    name: 'Public Safety',
    code: 'SAFE',
    subcategories: ["Illegal Activity", "Noise Complaint", "Harassment", "Encroachment", "Others"],
    slaConfig: { level1: 2, level2: 5, level3: 15 },
  },
  {
    id: 'dept_health',
    name: 'Healthcare',
    code: 'HLTH',
    subcategories: ["Hospital Staff Issue", "Medicine Unavailable", "Emergency Delay", "Cleanliness Issue", "Others"],
    slaConfig: { level1: 1, level2: 3, level3: 7 },
  },
  {
    id: 'dept_edu',
    name: 'Education',
    code: 'EDU',
    subcategories: ["Teacher Absence", "Infrastructure Issue", "Admission Problem", "Fee Complaint", "Others"],
    slaConfig: { level1: 2, level2: 5, level3: 12 },
  },
  {
    id: 'dept_rev',
    name: 'Revenue / Land',
    code: 'REV',
    subcategories: ["Property Dispute", "Land Record Issue", "Encroachment", "Mutation Delay", "Others"],
    slaConfig: { level1: 5, level2: 12, level3: 30 },
  },
];

export const DISTRICTS = ['Central', 'North', 'South', 'East', 'West', 'Suburban'];

export const PRIORITY_KEYWORDS: Record<Priority, string[]> = {
  [Priority.URGENT]: ['death', 'fire', 'flood', 'collapsed', 'bleeding', 'explosion'],
  [Priority.HIGH]: ['emergency', 'accident', 'no water', 'no electricity', 'theft', 'injury'],
  [Priority.MEDIUM]: ['garbage', 'pothole', 'street light', 'leak', 'bills', 'noise'],
  [Priority.LOW]: ['delay', 'information', 'general enquiry', 'suggestion'],
};

export const STORAGE_KEYS = {
  USERS: 'civicai_users',
  COMPLAINTS: 'civicai_complaints',
  SESSION: 'civicai_session',
  NOTIFICATIONS: 'civicai_notifications',
};
