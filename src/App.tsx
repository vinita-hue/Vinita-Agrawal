/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  auth, db, handleFirestoreError, OperationType 
} from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  deleteDoc,
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where,
  getDocs,
  orderBy,
  Timestamp,
  serverTimestamp,
  writeBatch,
  deleteField
} from 'firebase/firestore';
import { 
  LogOut, 
  UserPlus, 
  Users, 
  ClipboardCheck, 
  FileText, 
  MapPin, 
  Download,
  Plus,
  CheckCircle2,
  Clock,
  Camera,
  X,
  UserCheck,
  Trash2,
  Shield,
  ShieldAlert,
  AlertTriangle,
  ShieldCheck,
  CheckSquare,
  Check,
  ClipboardList,
  Edit2,
  Layers,
  DraftingCompass,
  FileDown
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { GoogleGenAI, Type } from "@google/genai";
import { cn, calculateDistance } from './lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

import { UserProfile, Attendance, Client, UserRole, SafetyCheck, LabourEntry, SiteReport, ReportHead, CONSTRUCTION_STAGES, DesignRequirement } from './types';

// --- Error Boundary Component ---
function ErrorDisplay({ error, reset }: { error: string, reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-red-50 text-red-900">
      <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
      <pre className="bg-white p-4 rounded border border-red-200 text-xs overflow-auto max-w-full mb-4">
        {error}
      </pre>
      <Button onClick={reset}>Try Again</Button>
    </div>
  );
}

// --- Helper Functions ---
const safeFormat = (date: any, formatStr: string, fallback: string = 'N/A') => {
  try {
    if (!date) return fallback;
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return fallback;
    return format(d, formatStr);
  } catch (e) {
    return fallback;
  }
};

const safeParseISO = (dateStr: string | undefined | null) => {
  if (!dateStr) return null;
  try {
    const d = parseISO(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
};

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // in metres
}

function findNearestClient(lat: number, lon: number, clients: Client[]) {
  if (clients.length === 0) return null;
  
  let nearest = null;
  let minDistance = 1000; // 1km threshold

  for (const client of clients) {
    if (!client.siteLocation) continue;
    const dist = getDistance(lat, lon, client.siteLocation.latitude, client.siteLocation.longitude);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = client;
    }
  }
  return nearest;
}

// --- Confirmation Dialog ---
function ConfirmDialog({ 
  open, 
  onOpenChange, 
  onConfirm, 
  title, 
  description, 
  confirmText = "Delete",
  variant = "destructive" 
}: { 
  open: boolean, 
  onOpenChange: (open: boolean) => void, 
  onConfirm: () => Promise<void>, 
  title: string, 
  description: string,
  confirmText?: string,
  variant?: "default" | "destructive"
}) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold uppercase tracking-tight">{title}</DialogTitle>
          <div className="py-4 text-sm text-slate-500 leading-relaxed">
            {description}
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading} className="font-bold uppercase tracking-widest text-[10px]">
            Cancel
          </Button>
          <Button 
            variant={variant === "destructive" ? "destructive" : "default"} 
            onClick={handleConfirm} 
            disabled={loading}
            className={cn(
              "font-bold uppercase tracking-widest text-[10px]",
              variant === "default" && "bg-yellow-400 text-black hover:bg-yellow-500"
            )}
          >
            {loading ? "Processing..." : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [siteReports, setSiteReports] = useState<SiteReport[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [safetyChecks, setSafetyChecks] = useState<SafetyCheck[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [reportHeads, setReportHeads] = useState<ReportHead[]>([]);
  const [designRequirements, setDesignRequirements] = useState<DesignRequirement[]>([]);
  const [activeTab, setActiveTab] = useState('attendance');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  
  // Online/Offline listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Geolocation watcher
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setCurrentLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        });
        setLocationError(null);
      },
      (err) => {
        console.warn('Location watch error:', err);
        // Don't set error if we already have a location (might just be a temporary timeout)
        if (!currentLocation) {
          setLocationError(err.message);
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [currentLocation]);

  // Delete Confirmation State
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => Promise<void>;
  }>({
    open: false,
    title: '',
    description: '',
    onConfirm: async () => {}
  });

  const triggerDelete = (title: string, description: string, onConfirm: () => Promise<void>) => {
    setDeleteConfirm({
      open: true,
      title,
      description,
      onConfirm
    });
  };
  
  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const isAdmin = firebaseUser.email === 'vinita@reidiusinfra.com' || firebaseUser.email === 'vinitaagrawalec@gmail.com';
        
        setUser(firebaseUser);
        let userDoc;
        try {
          userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
          return;
        }

        if (userDoc.exists()) {
          const profileData = userDoc.data() as UserProfile;
          setProfile(profileData);
          if (profileData.role === 'sales') {
            setActiveTab('visits');
          } else if (profileData.role === 'architect') {
            setActiveTab('design');
          } else if (['electrician', 'plumber', 'flooring_team'].includes(profileData.role || '')) {
            setActiveTab('labour');
          }
        } else {
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            name: firebaseUser.displayName || 'Engineer',
            email: firebaseUser.email || '',
            role: isAdmin ? 'admin' : 'engineer'
          };
          try {
            await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
            setProfile(newProfile);
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `users/${firebaseUser.uid}`);
          }
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Real-time data listeners
  useEffect(() => {
    if (!user || !profile) return;

    const attendanceQuery = (profile.role === 'admin' || profile.role === 'sales')
      ? query(collection(db, 'attendance'), orderBy('timestamp', 'desc'))
      : query(collection(db, 'attendance'), where('userId', '==', profile.uid));

    const unsubscribeAttendance = onSnapshot(attendanceQuery, (snapshot) => {
      let attendanceList = snapshot.docs.map(doc => {
        const data = doc.data();
        let timestamp = data.timestamp;
        if (timestamp instanceof Timestamp) {
          timestamp = timestamp.toDate().toISOString();
        } else if (!timestamp) {
          // Fallback for pending server timestamps
          timestamp = new Date().toISOString();
        }
        return { 
          id: doc.id, 
          ...data,
          timestamp
        } as Attendance;
      });

      // Sort client-side for engineers to avoid composite index requirement
      if (profile.role !== 'admin') {
        attendanceList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      }

      setAttendance(attendanceList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'attendance'));

    const clientsQuery = query(collection(db, 'clients'), orderBy('createdAt', 'desc'));
    const unsubscribeClients = onSnapshot(clientsQuery, (snapshot) => {
      const clientList = snapshot.docs.map(doc => {
        const data = doc.data();
        let createdAt = data.createdAt;
        if (createdAt instanceof Timestamp) {
          createdAt = createdAt.toDate().toISOString();
        } else if (!createdAt) {
          createdAt = new Date().toISOString();
        }
        return { id: doc.id, ...data, createdAt } as Client;
      });
      setClients(clientList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'clients'));

    const safetyQuery = query(collection(db, 'safety_checkpoints'), orderBy('createdAt', 'asc'));
    const unsubscribeSafety = onSnapshot(safetyQuery, (snapshot) => {
      const safetyList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SafetyCheck));
      setSafetyChecks(safetyList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'safety_checkpoints'));

    const headsQuery = query(collection(db, 'report_heads'), orderBy('createdAt', 'asc'));
    const unsubscribeHeads = onSnapshot(headsQuery, (snapshot) => {
      const headsList = snapshot.docs.map(doc => {
        const data = doc.data();
        let createdAt = data.createdAt;
        if (createdAt instanceof Timestamp) {
          createdAt = createdAt.toDate().toISOString();
        } else if (!createdAt) {
          createdAt = new Date().toISOString();
        }
        return { id: doc.id, ...data, createdAt } as ReportHead;
      });
      setReportHeads(headsList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'report_heads'));

    const reportsQuery = (profile.role === 'admin' || profile.role === 'sales' || profile.role === 'qa' || isSpecialUser)
      ? query(collection(db, 'site_reports'), orderBy('timestamp', 'desc'))
      : query(collection(db, 'site_reports'), where('engineerId', '==', profile.uid));

    const unsubscribeReports = onSnapshot(reportsQuery, (snapshot) => {
      let reportsList = snapshot.docs.map(doc => {
        const data = doc.data();
        let timestamp = data.timestamp;
        if (timestamp instanceof Timestamp) {
          timestamp = timestamp.toDate().toISOString();
        } else if (!timestamp) {
          timestamp = new Date().toISOString();
        }
        return { id: doc.id, ...data, timestamp } as SiteReport;
      });

      // Sort client-side for engineers to avoid composite index requirement
      if (profile.role !== 'admin') {
        reportsList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      }

      setSiteReports(reportsList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'site_reports'));

    const designQuery = query(collection(db, 'design_requirements'), orderBy('timestamp', 'desc'));
    const unsubscribeDesign = onSnapshot(designQuery, (snapshot) => {
      const designList = snapshot.docs.map(doc => {
        const data = doc.data();
        let timestamp = data.timestamp;
        if (timestamp instanceof Timestamp) {
          timestamp = timestamp.toDate().toISOString();
        } else if (!timestamp) {
          timestamp = new Date().toISOString();
        }
        return { id: doc.id, ...data, timestamp } as DesignRequirement;
      });
      setDesignRequirements(designList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'design_requirements'));

    let unsubscribeUsers = () => {};
    if (profile.role === 'admin' || profile.role === 'sales') {
      const usersQuery = query(collection(db, 'users'), orderBy('name', 'asc'));
      unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
        const userList = snapshot.docs.map(doc => doc.data() as UserProfile);
        setAllUsers(userList);
      }, (err) => handleFirestoreError(err, OperationType.LIST, 'users'));
    }

    return () => {
      unsubscribeAttendance();
      unsubscribeClients();
      unsubscribeSafety();
      unsubscribeHeads();
      unsubscribeReports();
      unsubscribeDesign();
      unsubscribeUsers();
    };
  }, [user, profile]);

  const handleLogin = async () => {
    if (loggingIn) return;
    setLoggingIn(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error('Login failed', err);
      if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
        // Just reset the state, no need to show a big error for user cancellation
        setLoggingIn(false);
        return;
      }
      setError('Login failed. Please try again.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => signOut(auth);

  // Auto-sync for admin when list is empty
  useEffect(() => {
    const isAdmin = profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com';
    if (user && isAdmin && clients.length === 0 && loading === false) {
      // Small delay to ensure snapshot listeners are settled
      const timer = setTimeout(() => {
        if (clients.length === 0) {
          syncClientsToFirebase();
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [user, profile, clients.length, loading]);

  const syncClientsToFirebase = async () => {
    const hardcodedClients: Client[] = [
      { id: '1', name: "Mukesh Shahani", siteLocation: { latitude: 26.82721519470215, longitude: 75.7149429321289 }, createdAt: new Date().toISOString() },
      { id: '2', name: "Ajay Bhaskar", siteLocation: { latitude: 26.9464054107666, longitude: 75.7160339355468 }, createdAt: new Date().toISOString() },
      { id: '3', name: "Jitendera Shrotiya", siteLocation: { latitude: 26.74989128112793, longitude: 75.8674468994140 }, createdAt: new Date().toISOString() },
      { id: '4', name: "Abhishek Singh Solanki", siteLocation: { latitude: 26.80421257019043, longitude: 75.8954315185546 }, createdAt: new Date().toISOString() },
      { id: '5', name: "Jitendera Yadav", siteLocation: { latitude: 26.82092094421386, longitude: 75.8547286987304 }, createdAt: new Date().toISOString() },
      { id: '6', name: "Ravindera ji", siteLocation: { latitude: 26.83019256591797, longitude: 75.851318359375 }, createdAt: new Date().toISOString() },
      { id: '7', name: "Pankaj Gupta", siteLocation: { latitude: 26.88532829284668, longitude: 75.7939758300781 }, createdAt: new Date().toISOString() },
      { id: '8', name: "Anil meena", siteLocation: { latitude: 26.82092094421386, longitude: 75.8547286987304 }, createdAt: new Date().toISOString() },
      { id: '9', name: "Col. H . Thakural", siteLocation: { latitude: 26.85641288757324, longitude: 75.6045913696289 }, createdAt: new Date().toISOString() },
      { id: '10', name: "Vikas Ahelawat", siteLocation: { latitude: 26.929262, longitude: 75.715714 }, createdAt: new Date().toISOString() },
      { id: '11', name: "Nitesh Pareek", siteLocation: { latitude: 26.968483, longitude: 75.7777596 }, createdAt: new Date().toISOString() },
      { id: '12', name: "Jatin Singh ( Anil Panwar)", createdAt: new Date().toISOString() },
      { id: '13', name: "Gopal Sharma", siteLocation: { latitude: 26.79705619812011, longitude: 75.8114089965820 }, createdAt: new Date().toISOString() },
      { id: '14', name: "Sumendera Singh", createdAt: new Date().toISOString() },
      { id: '15', name: "Rajesh Kumar Bairwa", siteLocation: { latitude: 26.76908302307129, longitude: 75.8065795898437 }, createdAt: new Date().toISOString() },
      { id: '16', name: "Uday Meena", siteLocation: { latitude: 26.74773788452148, longitude: 75.9337844848632 }, createdAt: new Date().toISOString() },
      { id: '17', name: "Om Prakash ji/ Pritam ji", createdAt: new Date().toISOString() },
      { id: '18', name: "Vijay Gupta", createdAt: new Date().toISOString() },
      { id: '19', name: "Manish Khandelwal", createdAt: new Date().toISOString() },
      { id: '20', name: "Himanshu Jain", createdAt: new Date().toISOString() },
      { id: '21', name: "Sunil Mahawar", createdAt: new Date().toISOString() },
      { id: '22', name: "Manish Sharma", createdAt: new Date().toISOString() },
      { id: '23', name: "Subhash patodia", siteLocation: { latitude: 26.89349937438965, longitude: 75.7171783447265 }, createdAt: new Date().toISOString() },
      { id: '24', name: "Vaibhav Agarwal", createdAt: new Date().toISOString() },
      { id: '25', name: "Jagmeet Ji Phase II", createdAt: new Date().toISOString() },
      { id: '26', name: "Hitesh Ji II Stage", siteLocation: { latitude: 26.87757873535156, longitude: 75.7200469970703 }, createdAt: new Date().toISOString() },
      { id: '27', name: "Aashish Ji Phase II", siteLocation: { latitude: 26.8290689, longitude: 75.6471306 }, createdAt: new Date().toISOString() },
      { id: '28', name: "Anugraha Gupta", siteLocation: { latitude: 26.823534, longitude: 75.837540 }, createdAt: new Date().toISOString() },
      { id: '29', name: "Sunny Ji ( Rajapark )", createdAt: new Date().toISOString() },
      { id: '30', name: "Shipra Gupta", createdAt: new Date().toISOString() },
      { id: '31', name: "Vipul Mamodia", createdAt: new Date().toISOString() },
      { id: '32', name: "Maa Baglamukhi Dhaam", createdAt: new Date().toISOString() },
      { id: '33', name: "Surendera Luthara", siteLocation: { latitude: 26.80793571472168, longitude: 75.8900909423828 }, createdAt: new Date().toISOString() },
      { id: '34', name: "Anoop Vashishtha", createdAt: new Date().toISOString() },
      { id: '35', name: "Nikhil Soni", siteLocation: { latitude: 26.84039497375488, longitude: 75.8302688598632 }, createdAt: new Date().toISOString() },
      { id: '36', name: "Kartik Ji", createdAt: new Date().toISOString() },
      { id: '37', name: "Shubham Soni", siteLocation: { latitude: 26.9419042, longitude: 75.7419307 }, createdAt: new Date().toISOString() },
      { id: '38', name: "Ravi Vijay", siteLocation: { latitude: 26.91513061523437, longitude: 75.8834915161132 }, createdAt: new Date().toISOString() },
      { id: '39', name: "Hemendera", siteLocation: { latitude: 26.89109992980957, longitude: 75.8278121948242 }, createdAt: new Date().toISOString() },
      { id: '40', name: "Sachin Sharma", siteLocation: { latitude: 26.86593818664550, longitude: 75.7463378 }, createdAt: new Date().toISOString() },
      { id: '41', name: "Dr Surendera", siteLocation: { latitude: 26.9527011, longitude: 75.7307889 }, createdAt: new Date().toISOString() },
      { id: '42', name: "Manish Natani", siteLocation: { latitude: 26.9620204, longitude: 75.7938213 }, createdAt: new Date().toISOString() },
      { id: '43', name: "Sooryankant Sharma", siteLocation: { latitude: 26.952763, longitude: 75.712868 }, createdAt: new Date().toISOString() },
      { id: '44', name: "Lalita Choudhary ji", siteLocation: { latitude: 26.8745844, longitude: 75.7363703 }, createdAt: new Date().toISOString() }
    ];

    try {
      const batch = writeBatch(db);
      for (const client of hardcodedClients) {
        const q = query(collection(db, 'clients'), where('name', '==', client.name));
        const existingDocs = await getDocs(q);
        if (existingDocs.empty) {
          const docRef = doc(collection(db, 'clients'));
          const clientData: any = {
            name: client.name,
            createdAt: serverTimestamp()
          };
          
          if (client.siteLocation) {
            clientData.siteLocation = client.siteLocation;
          }
          
          batch.set(docRef, clientData);
        }
      }
      await batch.commit();
      alert('Clients synced successfully');
    } catch (err) {
      console.error(err);
      alert('Failed to sync clients. See console for details.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-500"></div>
      </div>
    );
  }

  if (error) {
    return <ErrorDisplay error={error} reset={() => setError(null)} />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black p-4">
        <Card className="w-full max-w-md shadow-2xl border-t-8 border-yellow-500 bg-white">
          <CardHeader className="text-center">
            <div className="mx-auto bg-yellow-400 p-4 rounded-2xl w-fit mb-4 shadow-lg">
              <ClipboardCheck className="h-10 w-10 text-black" />
            </div>
            <CardTitle className="text-lg sm:text-xl font-heading font-bold uppercase tracking-tight whitespace-nowrap">Reidius Infra Private Limited</CardTitle>
            <CardDescription className="text-slate-500 font-medium italic">Construction Management System</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">
              Authorized Staff Access
            </div>
            <Button 
              onClick={handleLogin} 
              disabled={loggingIn}
              className="w-full py-7 text-lg font-bold bg-yellow-400 hover:bg-yellow-500 text-black transition-all shadow-sm"
            >
              {loggingIn ? 'Signing in...' : 'Sign in with Google'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isSpecialUser = profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com';
  const isLabourRole = ['electrician', 'plumber', 'flooring_team'].includes(profile?.role || '');
  const isSales = profile?.role === 'sales';
  const isArchitect = profile?.role === 'architect';

  const getGridCols = () => {
    if (isSpecialUser) return 'sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12';
    if (isSales) return 'sm:grid-cols-2';
    if (isArchitect) return 'sm:grid-cols-1';
    if (isLabourRole) return 'sm:grid-cols-2 md:grid-cols-4';
    if (profile?.role === 'site_supervisor') return 'sm:grid-cols-3 md:grid-cols-5';
    return 'sm:grid-cols-2 md:grid-cols-4';
  };

  return (
    <div className="min-h-screen bg-white pb-20 font-sans">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-50 px-3 py-3 sm:px-4 sm:py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="bg-yellow-400 p-1.5 sm:p-2 rounded-xl shrink-0">
            <ClipboardCheck className="h-5 w-5 sm:h-6 sm:w-6 text-black" />
          </div>
          <div className="flex flex-col min-w-0">
            <h1 className="font-heading font-bold text-[12px] min-[360px]:text-[14px] sm:text-xl tracking-tight uppercase leading-none whitespace-nowrap truncate">
              Reidius Infra Private Limited
            </h1>
            <div className="flex items-center gap-1 mt-0.5 sm:mt-1">
              <div className={cn("h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full", isOnline ? "bg-green-500 animate-pulse" : "bg-red-500")} />
              <p className="text-[7px] sm:text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none">
                {isOnline ? 'System Online' : 'Offline Mode (Auto-Sync)'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-4 shrink-0">
          <div className="flex flex-col items-end gap-0.5 sm:gap-1 mr-1 sm:mr-2">
            <div className="flex items-center gap-1 sm:gap-2">
              {currentLocation ? (
                <Badge variant="outline" className="bg-yellow-400/10 text-yellow-400 border-yellow-400/20 gap-1 px-1 sm:px-2 py-0.5 text-[7px] sm:text-[10px] font-bold uppercase tracking-wider">
                  <div className="h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full bg-yellow-400 animate-pulse" />
                  <span className="hidden min-[450px]:inline">GPS</span>
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-slate-500/10 text-slate-500 border-slate-500/20 gap-1 px-1 sm:px-2 py-0.5 text-[7px] sm:text-[10px] font-bold uppercase tracking-wider">
                  <div className="h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full bg-slate-500 animate-pulse" />
                  <span className="hidden min-[450px]:inline">GPS</span>
                </Badge>
              )}
            </div>
            {currentLocation && (
              <div className="hidden sm:flex items-center gap-1 text-[8px] font-bold text-yellow-400 uppercase tracking-widest">
                <MapPin className="h-2 w-2" />
                <span>{currentLocation.latitude.toFixed(4)}, {currentLocation.longitude.toFixed(4)}</span>
              </div>
            )}
            {locationError && !currentLocation && (
              <div className="hidden sm:block text-[7px] font-bold text-red-400 uppercase tracking-widest">
                GPS Error: {locationError.slice(0, 15)}...
              </div>
            )}
          </div>
          <div className="text-right hidden md:block">
            <p className="text-xs font-bold uppercase tracking-wider">{profile?.name}</p>
            <p className="text-[9px] text-yellow-400 font-bold uppercase tracking-[0.2em]">{profile?.role}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} className="text-white hover:bg-yellow-400 hover:text-black rounded-xl transition-colors h-8 w-8 sm:h-10 sm:w-10">
            <LogOut className="h-4 w-4 sm:h-6 sm:w-6" />
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-8 pb-36 sm:pb-12">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className={cn(
            "flex overflow-x-auto sm:grid mb-12 bg-slate-100/50 border border-slate-200 p-2 rounded-2xl h-auto shadow-sm no-scrollbar auto-rows-fr transition-all outline-none",
            isSpecialUser ? "gap-3 sm:gap-4" : "gap-1.5",
            "max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:z-50 max-sm:mb-0 max-sm:rounded-none max-sm:border-t max-sm:border-slate-200 max-sm:bg-white max-sm:p-2 max-sm:justify-start max-sm:h-20 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:w-full max-sm:px-4 max-sm:shadow-[0_-4px_10px_rgba(0,0,0,0.05)]",
            isArchitect && "sm:max-w-xs mx-auto",
            getGridCols()
          )}>
            {profile && !isArchitect && (
              <TabsTrigger value="attendance" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <Clock className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Logs</span>
              </TabsTrigger>
            )}
            {(['electrician', 'plumber', 'flooring_team', 'admin'].includes(profile?.role || '') || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com') && (
              <TabsTrigger value="labour" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <Users className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Labour</span>
              </TabsTrigger>
            )}
            {profile && !isSales && !isArchitect && (
              <TabsTrigger value="live" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <Users className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Live</span>
              </TabsTrigger>
            )}
            {(isSpecialUser) && (
              <TabsTrigger value="status" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <ClipboardCheck className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Status</span>
              </TabsTrigger>
            )}
            {(isSpecialUser || isSales) && (
              <TabsTrigger value="visits" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <MapPin className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Visits</span>
              </TabsTrigger>
            )}
            {(profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com') && (
              <TabsTrigger value="users" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <Shield className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Access</span>
              </TabsTrigger>
            )}
            {(profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com') && (
              <TabsTrigger value="safety" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <ShieldCheck className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Safety</span>
              </TabsTrigger>
            )}
            {(profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com') && (
              <TabsTrigger value="heads" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <ClipboardList className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Heads</span>
              </TabsTrigger>
            )}
            {(profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com') && (
              <TabsTrigger value="clients" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <UserPlus className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Clients</span>
              </TabsTrigger>
            )}
            {profile && !isSales && !isArchitect && (
              <TabsTrigger value="reports" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <FileText className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Reports</span>
              </TabsTrigger>
            )}
            {(profile?.role === 'engineer' || profile?.role === 'qa' || profile?.role === 'site_supervisor' || isSpecialUser) && (
              <TabsTrigger value="material" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <Layers className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Material</span>
              </TabsTrigger>
            )}
            {(profile?.role === 'engineer' || profile?.role === 'architect' || isSpecialUser) && (
              <TabsTrigger value="design" className="py-2.5 px-4 sm:px-3 rounded-xl font-bold uppercase text-[10px] tracking-widest data-[state=active]:bg-black data-[state=active]:text-yellow-400 data-[state=active]:shadow-md transition-all shrink-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 hover:bg-slate-50 border border-transparent data-[state=active]:border-black/5">
                <DraftingCompass className="h-5 w-5 sm:h-4 sm:w-4" />
                <span className="text-[9px] sm:text-[10px]">Design</span>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="attendance">
            <AttendanceView 
              attendance={attendance} 
              siteReports={siteReports} 
              profile={profile} 
              user={user}
              clients={clients} 
              safetyChecks={safetyChecks} 
              reportHeads={reportHeads}
              onDelete={triggerDelete}
              currentLocation={currentLocation}
            />
          </TabsContent>

          {!isSales && (
            <TabsContent value="live">
              <LiveStatusView attendance={attendance} siteReports={siteReports} clients={clients} />
            </TabsContent>
          )}

          {(isSpecialUser) && (
            <TabsContent value="status">
              <ProjectStatusView clients={clients} siteReports={siteReports} />
            </TabsContent>
          )}

          {(['electrician', 'plumber', 'flooring_team', 'admin'].includes(profile?.role || '') || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com') && (
            <TabsContent value="labour">
              <LabourReportView siteReports={siteReports} />
            </TabsContent>
          )}

          {(isSpecialUser || isSales) && (
            <TabsContent value="visits">
              <VisitsView siteReports={siteReports} allUsers={allUsers} attendance={attendance} />
            </TabsContent>
          )}

          {(profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com') && (
            <TabsContent value="users">
              <UsersView users={allUsers} currentProfile={profile} isAdmin={profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com'} />
            </TabsContent>
          )}

          {(profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com') && (
            <TabsContent value="safety">
              <SafetyView safetyChecks={safetyChecks} isAdmin={profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com'} onDelete={triggerDelete} />
            </TabsContent>
          )}

          {(profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com') && (
            <TabsContent value="heads">
              <ReportHeadsView reportHeads={reportHeads} isAdmin={profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com'} onDelete={triggerDelete} />
            </TabsContent>
          )}

          {(isSpecialUser) && (
            <TabsContent value="clients">
              <ClientsView 
                clients={clients} 
                isAdmin={profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com'} 
                currentLocation={currentLocation} 
                onDelete={triggerDelete} 
                onSync={syncClientsToFirebase}
              />
            </TabsContent>
          )}

          {!isSales && (
            <TabsContent value="reports">
              <ReportsView 
                attendance={attendance} 
                siteReports={siteReports} 
                isAdmin={profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com'} 
                profile={profile}
                clients={clients} 
                onDelete={triggerDelete}
              />
            </TabsContent>
          )}

          {(profile?.role === 'engineer' || profile?.role === 'qa' || profile?.role === 'site_supervisor' || isSpecialUser) && (
            <TabsContent value="material">
              <MaterialQualityView siteReports={siteReports} profile={profile} clients={clients} currentLocation={currentLocation} />
            </TabsContent>
          )}

          {(profile?.role === 'engineer' || profile?.role === 'architect' || isSpecialUser) && (
            <TabsContent value="design">
              <DesignRequirementsView 
                designRequirements={designRequirements} 
                profile={profile} 
                clients={clients} 
              />
            </TabsContent>
          )}
        </Tabs>
      </main>

      {/* Quick Action FAB for Mobile */}
      <div className="fixed bottom-24 right-6 sm:hidden flex flex-col gap-4 z-40">
        <SiteReportDialog profile={profile} clients={clients} reportHeads={reportHeads} currentLocation={currentLocation} />
      </div>

      <ConfirmDialog 
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm(prev => ({ ...prev, open }))}
        title={deleteConfirm.title}
        description={deleteConfirm.description}
        onConfirm={deleteConfirm.onConfirm}
      />
    </div>
  );
}

// --- Site Report Dialog ---
function SiteReportDialog({ 
  profile, 
  clients, 
  reportHeads,
  currentLocation
}: { 
  profile: UserProfile | null, 
  clients: Client[], 
  reportHeads: ReportHead[],
  currentLocation: { latitude: number, longitude: number } | null
}) {
  const [open, setOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [images, setImages] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState('');
  const [currentStage, setCurrentStage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [labourEntries, setLabourEntries] = useState<LabourEntry[]>([]);
  const [selectedSafetyChecks, setSelectedSafetyChecks] = useState<string[]>([]);
  const [nextStages, setNextStages] = useState('');
  const [purposeOfVisit, setPurposeOfVisit] = useState('');
  const [safetyChecks, setSafetyChecks] = useState<SafetyCheck[]>([]);
  const [newLabour, setNewLabour] = useState<LabourEntry>({ name: '', role: 'Mason', jobWork: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch safety checks
  useEffect(() => {
    const q = query(collection(db, 'safety_checkpoints'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setSafetyChecks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SafetyCheck)));
    });
  }, []);

  const detectNearestSite = () => {
    if (currentLocation) {
      const nearest = findNearestClient(currentLocation.latitude, currentLocation.longitude, clients);
      if (nearest) {
        setSelectedClientId(nearest.id);
      } else {
        alert('No sites found within 1km of your current location.');
      }
    } else {
      alert('Current location not available yet. Please wait for GPS lock.');
    }
  };

  const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => {
        console.error('Failed to load image for compression');
        resolve(base64Str); // Fallback to original if compression fails
      };
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
    });
  };

  const handleImageCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const fileList = Array.from(files);
    const readers = fileList.map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const compressed = await compressImage(reader.result as string);
          resolve(compressed);
        };
        reader.readAsDataURL(file as Blob);
      });
    });

    Promise.all(readers).then(newImages => {
      setImages(prev => [...prev, ...newImages].slice(0, 5));
    });
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const runAiAnalysis = async () => {
    if (!navigator.onLine) {
      alert('AI Analysis requires an internet connection. Please try again when you are online.');
      return;
    }
    if (images.length === 0) {
      alert('Please capture at least one image first.');
      return;
    }
    setAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const imageParts = images.map(img => ({
        inlineData: {
          mimeType: "image/jpeg",
          data: img.split(',')[1]
        }
      }));

      const filteredHeads = reportHeads.filter(h => (h.role || 'engineer') === profile?.role);
      const isTradeRole = ['electrician', 'plumber', 'flooring_team'].includes(profile?.role || '');
      const headsText = filteredHeads.length > 0 
        ? `Focus on these specific technical heads: ${filteredHeads.map(h => h.title).join(', ')}.`
        : isTradeRole
          ? `Focus exclusively on the ${profile?.role.replace('_', ' ')} work being performed and the specific labour team present.`
          : "Identify the work being done, count or identify the types of labours present (e.g., masons, helpers), and provide a summary of site progress and any observations.";

      const isEngineerOrSupervisor = profile?.role === 'engineer' || profile?.role === 'site_supervisor';
      const wayForwardInstruction = (isEngineerOrSupervisor || isTradeRole)
        ? "DO NOT include any 'Way Forward' or 'Next Steps' suggestions."
        : "Also, identify and suggest the WAY FORWARD / REMARKS based on the current progress seen in the images.";

      const prompt = `Analyze these site images. ${headsText} ${wayForwardInstruction} 
      
      CRITICAL: Also identify the CURRENT PROJECT STAGE based on the images. 
      You MUST choose the most appropriate stage from this list: ${CONSTRUCTION_STAGES.join(', ')}.
      
      Format the output as a JSON object with two fields:
      1. "report": The professional site report as a numbered list (plain text, no markdown).
      2. "stage": One of the stages from the provided list.
      
      Example: {"report": "1. Masonry work in progress...", "stage": "Brickwork"}`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [...imageParts, { text: prompt }] },
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text || '{}');
      let cleanedText = result.report || 'AI analysis failed to generate content.';
      cleanedText = cleanedText.replace(/[#*]/g, '');
      
      setAiResult(cleanedText);
      setCurrentStage(result.stage || 'Unknown');
    } catch (err) {
      console.error('AI Analysis failed:', err);
      alert('AI Analysis failed. Please check your internet connection and try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSubmit = async () => {
    if (!profile) return;
    if (!selectedClientId) {
      alert('Please select a site/client first.');
      return;
    }
    if (images.length === 0) {
      alert('Please capture site images.');
      return;
    }
    if (profile.role === 'sales') {
      if (!purposeOfVisit.trim()) {
        alert('Please enter purpose of visit.');
        return;
      }
    } else {
      if (!aiResult && navigator.onLine) {
        alert('Please run AI analysis before submitting while online.');
        return;
      }
    }
    setSubmitting(true);
    
    try {
      console.log('Starting report submission...');
      const position = currentLocation ? { coords: currentLocation } : await new Promise<any>((resolve) => {
        if (!navigator.geolocation) {
          resolve({ coords: { latitude: 0, longitude: 0 } });
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, () => resolve({ coords: { latitude: 0, longitude: 0 } }), { 
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        });
      });

      console.log('Submitting to Firestore...');
      const selectedClient = clients.find(c => c.id === selectedClientId);
        await addDoc(collection(db, 'site_reports'), {
          engineerId: profile.uid,
          engineerName: profile.name,
          engineerRole: profile.role,
          clientId: selectedClientId,
          clientName: selectedClient?.name || 'Unknown',
          timestamp: serverTimestamp(),
          dateStr: safeFormat(new Date(), 'yyyy-MM-dd'),
          images: images,
          aiAnalysis: profile.role === 'sales' ? `PURPOSE OF VISIT: ${purposeOfVisit}` : (aiResult || 'Offline Submission - Pending AI Analysis'),
          currentStage: profile.role === 'sales' ? '' : (currentStage || 'Unknown'),
          labourEntries: profile.role === 'sales' ? [] : labourEntries,
          safetyChecks: profile.role === 'sales' ? [] : selectedSafetyChecks,
          nextStages: profile.role === 'sales' ? '' : nextStages,
          purposeOfVisit: profile.role === 'sales' ? purposeOfVisit : '',
          isOffline: !navigator.onLine,
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          }
        });

        // Update client current stage
        if (currentStage && profile.role !== 'sales') {
          await updateDoc(doc(db, 'clients', selectedClientId), {
            currentStage: currentStage
          });
        }

        setOpen(false);
        setImages([]);
        setAiResult('');
        setCurrentStage('');
        setSelectedClientId('');
        setLabourEntries([]);
        setSelectedSafetyChecks([]);
        setNextStages('');
        setPurposeOfVisit('');
        alert('Site report submitted successfully!');
    } catch (err: any) {
      console.error('Report submission failed:', err);
      const errorMessage = err?.message || String(err);
      alert(`Report submission failed: ${errorMessage}. Please check your internet connection and permissions.`);
      handleFirestoreError(err, OperationType.CREATE, 'site_reports');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button size="lg" className="rounded-full h-16 w-16 shadow-lg bg-black hover:bg-slate-800 text-yellow-400 border-2 border-yellow-400">
          <Camera className="h-7 w-7" />
        </Button>
      } />
      <DialogContent className="sm:max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-bold uppercase tracking-tight">Site Progress Report</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Select Site / Client</Label>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={detectNearestSite}
                className="h-7 text-[9px] font-bold uppercase tracking-widest text-yellow-600 hover:text-yellow-700"
              >
                <MapPin className="h-3 w-3 mr-1" />
                Detect Nearest
              </Button>
            </div>
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger className="h-12 border-slate-200 font-medium">
                <SelectValue placeholder="Select a site" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Site Images (Capture 4-5)</Label>
              <Button 
                onClick={() => {
                  fileInputRef.current?.click();
                }} 
                variant="outline" 
                size="sm" 
                disabled={images.length >= 5}
                className={cn(
                  "h-8 text-[9px] font-bold uppercase tracking-widest border-yellow-400 text-yellow-600 hover:bg-yellow-50"
                )}
              >
                <Camera className="h-3 w-3 mr-1" /> Capture Images
              </Button>
              <input 
                type="file" 
                accept="image/*" 
                multiple 
                capture="environment" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleImageCapture}
              />
            </div>
            
            {profile?.role === 'sales' && (
              <div className="space-y-2">
                <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Purpose of Visit</Label>
                <Textarea 
                  placeholder="Enter purpose of visit..." 
                  className="text-xs min-h-[100px] border-slate-200 focus:border-yellow-400 transition-all"
                  value={purposeOfVisit}
                  onChange={e => setPurposeOfVisit(e.target.value)}
                />
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {images.map((img, idx) => (
                <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-slate-100 shadow-sm group">
                  <img src={img} className="w-full h-full object-cover" />
                  <Button 
                    variant="destructive" 
                    size="icon" 
                    onClick={() => removeImage(idx)}
                    className="absolute top-1 right-1 h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {images.length === 0 && (
                <div className="col-span-full py-8 text-center border border-dashed border-slate-200 rounded-xl">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">No images captured yet</p>
                </div>
              )}
            </div>
          </div>

          {profile?.role !== 'sales' && (
            <>
              <div className="space-y-4">
                <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Available Person & Roles</Label>
                <div className="space-y-3">
                  {labourEntries.map((entry, idx) => (
                    <div key={idx} className="flex gap-2 items-start bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <p className="text-[10px] font-bold uppercase truncate">{entry.name} ({entry.role})</p>
                        <p className="text-[9px] text-slate-400 col-span-2 italic">{entry.jobWork}</p>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 text-red-500"
                        onClick={() => setLabourEntries(prev => prev.filter((_, i) => i !== idx))}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  
                  {labourEntries.length === 0 && (
                    <div className="p-4 text-center border border-dashed border-slate-200 bg-slate-50/30 rounded-lg">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                        Person details (Optional)
                      </p>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-2">
                    <Input 
                      placeholder="Person Name" 
                      className="h-10 text-xs col-span-2"
                      value={newLabour.name}
                      onChange={e => setNewLabour(prev => ({ ...prev, name: e.target.value }))}
                    />
                    <Select 
                      value={newLabour.role} 
                      onValueChange={(val: any) => setNewLabour(prev => ({ ...prev, role: val }))}
                    >
                      <SelectTrigger className="h-10 text-xs col-span-2">
                        <SelectValue placeholder="Role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Mason">Mason</SelectItem>
                        <SelectItem value="Helper">Helper</SelectItem>
                        <SelectItem value="Electrician">Electrician</SelectItem>
                        <SelectItem value="Plumber">Plumber</SelectItem>
                        <SelectItem value="Carpenter">Carpenter</SelectItem>
                        <SelectItem value="Painter">Painter</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input 
                      placeholder="Job Work / Task" 
                      className="h-10 text-xs col-span-2"
                      value={newLabour.jobWork}
                      onChange={e => setNewLabour(prev => ({ ...prev, jobWork: e.target.value }))}
                    />
                    <Button 
                      variant="outline" 
                      className="col-span-2 h-10 text-[10px] font-bold uppercase tracking-widest border-slate-200"
                      onClick={() => {
                        if (!newLabour.name || !newLabour.jobWork) return;
                        setLabourEntries(prev => [...prev, newLabour]);
                        setNewLabour({ name: '', role: 'Mason', jobWork: '' });
                      }}
                    >
                      Add Person
                    </Button>
                  </div>

                  {labourEntries.length > 0 && (
                    <div className="space-y-2 mt-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Added Persons ({labourEntries.length})</p>
                      <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                        {labourEntries.map((l, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-100">
                            <div className="flex flex-col">
                              <span className="text-[10px] font-bold uppercase">{l.name} ({l.role})</span>
                              <span className="text-[8px] text-slate-500 uppercase">{l.jobWork}</span>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-6 w-6 text-slate-300 hover:text-red-500"
                              onClick={() => setLabourEntries(prev => prev.filter((_, idx) => idx !== i))}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Safety Compliances Verified</Label>
                <div className="grid grid-cols-1 gap-2">
                  {safetyChecks.map((check) => (
                    <div 
                      key={check.id} 
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer",
                        selectedSafetyChecks.includes(check.task) 
                          ? "bg-green-50 border-green-200 text-green-700" 
                          : "bg-white border-slate-100 text-slate-600 hover:border-slate-200"
                      )}
                      onClick={() => {
                        setSelectedSafetyChecks(prev => 
                          prev.includes(check.task) 
                            ? prev.filter(t => t !== check.task) 
                            : [...prev, check.task]
                        );
                      }}
                    >
                      <div className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center",
                        selectedSafetyChecks.includes(check.task) ? "bg-green-500 border-green-500" : "border-slate-300"
                      )}>
                        {selectedSafetyChecks.includes(check.task) && <Check className="h-3 w-3 text-white" />}
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-tight">{check.task}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <Button 
                  onClick={runAiAnalysis} 
                  disabled={analyzing || images.length === 0 || !navigator.onLine}
                  className="w-full h-12 bg-black text-yellow-400 hover:bg-slate-900 font-bold uppercase tracking-widest disabled:opacity-50"
                >
                  {!navigator.onLine ? 'AI Analysis Unavailable (Offline)' : analyzing ? 'AI Analyzing Site...' : 'Generate AI Report'}
                </Button>

                {aiResult && (
                  <div className="space-y-2">
                    <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">AI Analysis Result (Editable)</Label>
                    <Textarea 
                      value={aiResult}
                      onChange={e => setAiResult(e.target.value)}
                      className="text-xs min-h-[200px] leading-relaxed bg-slate-50 border-slate-100"
                    />
                  </div>
                )}

                {!(profile?.role === 'engineer' || profile?.role === 'site_supervisor') && (
                  <div className="space-y-3">
                    <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Way Forward / Remarks</Label>
                    <Textarea 
                      placeholder="Enter way forward or remarks..." 
                      className="text-xs min-h-[80px]"
                      value={nextStages}
                      onChange={e => setNextStages(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting} className="w-full h-14 text-sm font-bold uppercase tracking-widest bg-yellow-400 text-black hover:bg-yellow-500 shadow-sm">
            {submitting ? 'Saving Report...' : 'Submit Site Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Material Quality View ---
function MaterialReportDialog({ 
  profile, 
  clients, 
  currentLocation 
}: { 
  profile: UserProfile | null, 
  clients: Client[], 
  currentLocation: { latitude: number, longitude: number } | null 
}) {
  const [open, setOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [materialImages, setMaterialImages] = useState<string[]>([]);
  const [materialAiResult, setMaterialAiResult] = useState('');
  const [materialRemarks, setMaterialRemarks] = useState('');
  const [materialAnalyzing, setMaterialAnalyzing] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<string>('River Sand');
  const [customMaterial, setCustomMaterial] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const materialFileInputRef = useRef<HTMLInputElement>(null);

  const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 600;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
    });
  };

  const handleMaterialImageCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const fileList = Array.from(files);
    const readers = fileList.map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const compressed = await compressImage(reader.result as string);
          resolve(compressed);
        };
        reader.readAsDataURL(file as Blob);
      });
    });
    Promise.all(readers).then(newImages => {
      setMaterialImages(prev => [...prev, ...newImages].slice(0, 3));
    });
  };

  const runMaterialAiAnalysis = async () => {
    if (!navigator.onLine) {
      alert('AI Analysis requires an internet connection.');
      return;
    }
    if (materialImages.length === 0) {
      alert('Please capture material images first.');
      return;
    }
    setMaterialAnalyzing(true);
    try {
      const actualMaterial = selectedMaterial === 'Other' ? customMaterial : selectedMaterial;
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const imageParts = materialImages.map(img => ({
        inlineData: {
          mimeType: "image/jpeg",
          data: img.split(',')[1]
        }
      }));
      const prompt = `Analyze these images of ${actualMaterial}. 
      Assess the quality based on visual characteristics (e.g., for sand: silt content, grain size; for aggregate: shape, size, dust; for bricks: color, edges, texture).
      Provide a professional quality assessment report.
      Format the output as a JSON object with one field:
      1. "analysis": The quality assessment report as a numbered list (plain text, no markdown).`;
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [...imageParts, { text: prompt }] },
        config: { responseMimeType: "application/json" }
      });
      const result = JSON.parse(response.text || '{}');
      setMaterialAiResult(result.analysis || 'Analysis failed.');
    } catch (err) {
      console.error('Material Analysis failed:', err);
      alert('Material Analysis failed.');
    } finally {
      setMaterialAnalyzing(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedClientId) {
      alert('Please select a site.');
      return;
    }
    if (materialImages.length === 0) {
      alert('Please capture material images.');
      return;
    }
    if (!materialAiResult) {
      alert('Please run AI analysis first.');
      return;
    }
    const actualMaterial = selectedMaterial === 'Other' ? customMaterial : selectedMaterial;
    if (!actualMaterial) {
      alert('Please specify the material name.');
      return;
    }
    
    if (!materialAiResult && navigator.onLine) {
      alert('Please run AI analysis first while online.');
      return;
    }

    setSubmitting(true);
    try {
      const selectedClient = clients.find(c => c.id === selectedClientId);
      const position = currentLocation || { latitude: 0, longitude: 0 };
      await addDoc(collection(db, 'site_reports'), {
        engineerId: profile?.uid,
        engineerName: profile?.name,
        engineerRole: profile?.role,
        clientId: selectedClientId,
        clientName: selectedClient?.name || 'Unknown',
        timestamp: serverTimestamp(),
        dateStr: format(new Date(), 'yyyy-MM-dd'),
        isOffline: !navigator.onLine,
        images: [], // progress images empty
        aiAnalysis: '', // progress analysis empty
        materialReport: {
          materialType: actualMaterial,
          images: materialImages,
          analysis: materialAiResult || 'Offline Submission - Pending Quality Analysis',
          remarks: materialRemarks
        },
        location: {
          latitude: position.latitude,
          longitude: position.longitude
        }
      });
      setOpen(false);
      setMaterialImages([]);
      setMaterialAiResult('');
      setMaterialRemarks('');
      setCustomMaterial('');
      setSelectedClientId('');
      alert('Material Quality Report submitted successfully!');
    } catch (err) {
      console.error('Submission failed:', err);
      alert('Submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button className="bg-blue-600 text-white hover:bg-blue-700 font-bold uppercase text-[10px] tracking-widest px-6">
          <Camera className="h-3.5 w-3.5 mr-2" />
          New Material Report
        </Button>
      } />
      <DialogContent className="sm:max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-bold uppercase tracking-tight">Material Quality Report</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Select Site / Client</Label>
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger className="h-12 border-slate-200 font-medium">
                <SelectValue placeholder="Select a site" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between">
              <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Capture Material</Label>
              <Button 
                onClick={() => {
                  materialFileInputRef.current?.click();
                }} 
                variant="outline" 
                size="sm" 
                disabled={materialImages.length >= 3}
                className="h-8 text-[9px] font-bold uppercase tracking-widest border-blue-400 text-blue-600 hover:bg-blue-50"
              >
                <Camera className="h-3 w-3 mr-1" /> Capture
              </Button>
              <input 
                type="file" 
                accept="image/*" 
                multiple 
                capture="environment" 
                className="hidden" 
                ref={materialFileInputRef}
                onChange={handleMaterialImageCapture}
              />
            </div>

            <div className="space-y-3">
              <Select value={selectedMaterial} onValueChange={setSelectedMaterial}>
                <SelectTrigger className="h-10 text-xs bg-white border-slate-200">
                  <SelectValue placeholder="Select Material" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="River Sand">River Sand</SelectItem>
                  <SelectItem value="Aggregate">Aggregate</SelectItem>
                  <SelectItem value="Bricks Quality">Bricks Quality</SelectItem>
                  <SelectItem value="Other">Other (Add New)</SelectItem>
                </SelectContent>
              </Select>

              {selectedMaterial === 'Other' && (
                <div className="space-y-2">
                  <Label className="font-bold uppercase tracking-[0.2em] text-[8px] text-slate-400">Material Name</Label>
                  <Input 
                    placeholder="Enter Material Name (e.g., Cement, Tiles)" 
                    value={customMaterial} 
                    onChange={e => setCustomMaterial(e.target.value)}
                    className="h-10 text-xs bg-white border-slate-200"
                  />
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                {materialImages.map((img, idx) => (
                  <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 shadow-sm group">
                    <img src={img} className="w-full h-full object-cover" />
                    <Button 
                      variant="destructive" 
                      size="icon" 
                      onClick={() => setMaterialImages(prev => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1 right-1 h-5 w-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button 
                onClick={runMaterialAiAnalysis} 
                disabled={materialAnalyzing || materialImages.length === 0 || !navigator.onLine}
                className="w-full h-10 bg-blue-600 text-white hover:bg-blue-700 text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
              >
                {materialAnalyzing ? 'Analyzing Material...' : 'Analyze Material Quality'}
              </Button>

              {materialAiResult && (
                <div className="space-y-2">
                  <Label className="font-bold uppercase tracking-[0.2em] text-[8px] text-slate-400">Quality Assessment (Editable)</Label>
                  <Textarea 
                    value={materialAiResult}
                    onChange={e => setMaterialAiResult(e.target.value)}
                    className="text-[10px] min-h-[100px] leading-relaxed bg-white border-slate-200"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label className="font-bold uppercase tracking-[0.2em] text-[8px] text-slate-400">Additional Remarks (Optional)</Label>
                <Textarea 
                  placeholder="Enter any additional observations or remarks..."
                  value={materialRemarks}
                  onChange={e => setMaterialRemarks(e.target.value)}
                  className="text-[10px] min-h-[60px] leading-relaxed bg-white border-slate-200"
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting} className="w-full h-14 text-sm font-bold uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700 shadow-sm">
            {submitting ? 'Saving Report...' : 'Submit Material Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaterialQualityView({ siteReports, profile, clients, currentLocation }: { 
  siteReports: SiteReport[], 
  profile: UserProfile | null, 
  clients: Client[], 
  currentLocation: { latitude: number, longitude: number } | null 
}) {
  const materialReports = siteReports
    .filter(r => r.materialReport)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const downloadMaterialPDF = () => {
    try {
      const doc = new jsPDF();
      
      // Header
      doc.setFillColor(30, 41, 59); // slate-800
      doc.rect(0, 0, 210, 40, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text("REIDIUS INFRA", 14, 25);
      doc.setFontSize(10);
      doc.text("MATERIAL QUALITY ASSESSMENT LOGS", 14, 32);
      
      let currentY = 50;
      
      materialReports.forEach((report) => {
        if (currentY > 240) {
          doc.addPage();
          currentY = 20;
        }
        
        doc.setFillColor(241, 245, 249); // slate-100
        doc.rect(14, currentY, 182, 10, 'F');
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(`${report.materialReport?.materialType.toUpperCase()} - ${report.clientName.toUpperCase()}`, 18, currentY + 7);
        
        currentY += 15;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(`Date: ${safeFormat(report.timestamp, 'PPP')}`, 14, currentY);
        doc.text(`Time: ${safeFormat(report.timestamp, 'hh:mm a')}`, 80, currentY);
        doc.text(`Engineer: ${report.engineerName}`, 140, currentY);
        
        currentY += 10;
        doc.setFont('helvetica', 'bold');
        doc.text("Quality Analysis:", 14, currentY);
        currentY += 5;
        doc.setFont('helvetica', 'normal');
        const analysisLines = doc.splitTextToSize(report.materialReport?.analysis || '', 180);
        doc.text(analysisLines, 14, currentY);
        currentY += (analysisLines.length * 4) + 5;
        
        if (report.materialReport?.remarks) {
          doc.setFont('helvetica', 'bold');
          doc.text("Remarks:", 14, currentY);
          currentY += 5;
          doc.setFont('helvetica', 'italic');
          const remarkLines = doc.splitTextToSize(report.materialReport.remarks, 180);
          doc.text(remarkLines, 14, currentY);
          currentY += (remarkLines.length * 4) + 5;
        }
        
        currentY += 5;
        doc.setDrawColor(226, 232, 240); // slate-200
        doc.line(14, currentY, 196, currentY);
        currentY += 10;
      });
      
      doc.save(`Material_Quality_Report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    } catch (error) {
      console.error('PDF Error:', error);
      alert('Failed to generate PDF');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold uppercase tracking-tight">Material Quality History</h2>
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            onClick={downloadMaterialPDF} 
            disabled={materialReports.length === 0}
            className="h-10 text-[10px] font-bold uppercase tracking-widest border-slate-200"
          >
            <Download className="h-3.5 w-3.5 mr-2" />
            Download PDF
          </Button>
          <MaterialReportDialog profile={profile} clients={clients} currentLocation={currentLocation} />
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none font-bold uppercase tracking-widest text-[10px] px-3 py-1">
            {materialReports.length} Reports
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {materialReports.length === 0 ? (
          <div className="py-20 text-center text-slate-300 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
            <Layers className="h-12 w-12 mx-auto mb-4 opacity-10" />
            <p className="font-bold uppercase tracking-[0.2em] text-[10px]">No material quality reports found</p>
          </div>
        ) : (
          materialReports.map((report) => (
            <Card key={report.id} className="border border-slate-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
              <CardContent className="p-0">
                <div className="bg-slate-50 p-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-600 p-2 rounded-lg">
                      <Layers className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm uppercase tracking-tight">{report.materialReport?.materialType}</h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        {report.clientName} • {safeFormat(report.timestamp, 'PPP')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{safeFormat(report.timestamp, 'hh:mm a')}</p>
                    <p className="text-[8px] text-blue-600 font-bold uppercase tracking-tighter">{report.engineerName}</p>
                  </div>
                </div>
                
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    {report.materialReport?.images.map((img, idx) => (
                      <div key={idx} className="aspect-square rounded-lg overflow-hidden border border-slate-100">
                        <img src={img} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                    ))}
                  </div>

                  <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 relative">
                    <div className="absolute -top-2 left-4 bg-blue-600 text-white text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded">
                      AI Quality Assessment
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap pt-2">
                      {report.materialReport?.analysis}
                    </p>
                  </div>

                  {report.materialReport?.remarks && (
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-1">Remarks</p>
                      <p className="text-xs text-slate-600 italic">"{report.materialReport.remarks}"</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
function AttendanceView({ 
  attendance, 
  siteReports, 
  profile, 
  user,
  clients, 
  safetyChecks, 
  reportHeads,
  onDelete,
  currentLocation
}: { 
  attendance: Attendance[], 
  siteReports: SiteReport[], 
  profile: UserProfile | null, 
  user: User | null,
  clients: Client[], 
  safetyChecks: SafetyCheck[],
  reportHeads: ReportHead[],
  onDelete: (title: string, description: string, onConfirm: () => Promise<void>) => void,
  currentLocation: { latitude: number, longitude: number } | null
}) {
  const [checkingIn, setCheckingIn] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
  const today = format(new Date(), 'yyyy-MM-dd');
  const myAttendanceToday = attendance.filter(a => a.userId === profile?.uid && a.dateStr === today);
  const lastAction = myAttendanceToday.length > 0 ? myAttendanceToday[0] : null; // Sorted desc by timestamp in listener

  const handleAttendance = async (type: 'check-in' | 'check-out') => {
    if (!profile) return;
    if (type === 'check-in' && !selectedSiteId) {
      setStatusMsg({ text: 'Please select a site before checking in', type: 'error' });
      return;
    }
    setCheckingIn(true);
    setStatusMsg(null);
    try {
      const position = currentLocation ? { coords: currentLocation } : await new Promise<any>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { 
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      }).catch((e) => {
        console.warn('Geolocation failed', e);
        return { coords: { latitude: 0, longitude: 0 } };
      });

      const selectedSite = clients.find(c => c.id === selectedSiteId);
      let isWithinGeoFence = true;
      let distance = 0;

      if (type === 'check-in' && selectedSite && selectedSite.siteLocation && navigator.onLine) {
        distance = calculateDistance(
          position.coords.latitude,
          position.coords.longitude,
          selectedSite.siteLocation.latitude,
          selectedSite.siteLocation.longitude
        );
        const radius = selectedSite.geoFenceRadius || 20;
        if (distance > radius) {
          isWithinGeoFence = false;
          setStatusMsg({ 
            text: `Geo-fence check failed: You are ${Math.round(distance)}m away. Limit is ${radius}m.`, 
            type: 'error' 
          });
          setCheckingIn(false);
          return;
        }
      }

      const attendanceData: any = {
        userId: profile.uid,
        laborName: profile.name,
        isEngineer: true,
        engineerRole: profile.role,
        type,
        timestamp: serverTimestamp(),
        dateStr: today,
        isOfflineMode: !navigator.onLine,
        location: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        }
      };

      if (selectedSiteId) {
        attendanceData.clientId = selectedSiteId;
        attendanceData.clientName = selectedSite?.name || 'Unknown Site';
      }

      await addDoc(collection(db, 'attendance'), attendanceData);
      
      const msg = `${type === 'check-in' ? 'Checked in' : 'Checked out'} successfully! ${!navigator.onLine ? '(Stored offline)' : ''}`;
      setStatusMsg({ text: msg, type: 'success' });
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (err: any) {
      console.error('Attendance error:', err);
      setStatusMsg({ text: `Failed to ${type}: ${err.message || 'Unknown error'}`, type: 'error' });
    } finally {
      setCheckingIn(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* My Attendance Section */}
      <Card className="border-2 border-yellow-400 shadow-lg overflow-hidden">
        <CardHeader className="bg-black text-white py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-heading font-bold uppercase tracking-tight flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-400" />
              My Attendance
            </CardTitle>
            <Badge variant="outline" className="border-yellow-400 text-yellow-400 text-[8px] font-bold uppercase tracking-widest">
              {today}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-6">
            {lastAction?.type !== 'check-in' && (
              <div className="space-y-2">
                <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Select Site for Check-in</Label>
                <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                  <SelectTrigger className="h-12 border-slate-200 font-medium bg-white">
                    <SelectValue placeholder="Choose a site..." />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map(client => (
                      <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
            <div className="space-y-1 text-center sm:text-left w-full sm:w-auto">
              <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest">Current Status</p>
              <div className="text-xl sm:text-2xl font-bold uppercase tracking-tight min-h-[32px] sm:min-h-[40px] flex items-center justify-center sm:justify-start">
                {lastAction?.type === 'check-in' ? (
                  <span className="text-green-600 flex items-center gap-2">
                    <CheckCircle2 className="h-6 w-6" /> Checked In
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center gap-2">
                    <LogOut className="h-6 w-6" /> Not Checked In
                  </span>
                )}
              </div>
              {lastAction && (
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2">
                  Last action: {lastAction.type} at {safeFormat(lastAction.timestamp, 'hh:mm a')}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-3 w-full sm:w-auto">
              <div className="flex gap-2 sm:gap-3">
                <Button 
                  disabled={checkingIn || lastAction?.type === 'check-in'}
                  onClick={() => handleAttendance('check-in')}
                  className="flex-1 sm:flex-none h-11 sm:h-14 px-4 sm:px-8 bg-green-600 hover:bg-green-700 text-white font-bold uppercase text-[10px] sm:text-xs tracking-widest shadow-md disabled:opacity-30 transition-all"
                >
                  {checkingIn && lastAction?.type !== 'check-in' ? '...' : 'Check In'}
                </Button>
                <Button 
                  disabled={checkingIn || lastAction?.type !== 'check-in'}
                  onClick={() => handleAttendance('check-out')}
                  className="flex-1 sm:flex-none h-11 sm:h-14 px-4 sm:px-8 bg-red-600 hover:bg-red-700 text-white font-bold uppercase text-[10px] sm:text-xs tracking-widest shadow-md disabled:opacity-30 transition-all"
                >
                  {checkingIn && lastAction?.type === 'check-in' ? '...' : 'Check Out'}
                </Button>
              </div>
              
              <AnimatePresence>
                {statusMsg && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-widest p-2 rounded text-center",
                      statusMsg.type === 'success' ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100"
                    )}
                  >
                    {statusMsg.text}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold uppercase tracking-tight">Site Activity</h2>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Reidius Infra Private Limited</p>
        </div>
        <div className="hidden sm:flex gap-3">
          <SiteReportDialog profile={profile} clients={clients} reportHeads={reportHeads} currentLocation={currentLocation} />
        </div>
      </div>

      <div className="space-y-6">
        {siteReports.length === 0 ? (
          <Card className="p-16 text-center text-slate-300 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
            <ClipboardCheck className="h-12 w-12 mx-auto mb-4 opacity-10" />
            <p className="font-bold uppercase tracking-[0.2em] text-[10px]">No site reports recorded yet</p>
          </Card>
        ) : (
          siteReports.map((report) => {
            const reportDate = report.dateStr || safeFormat(report.timestamp, 'yyyy-MM-dd');
            const dayAttendance = attendance.filter(a => a.userId === report.engineerId && a.dateStr === reportDate);
            const checkIn = dayAttendance.filter(a => a.type === 'check-in').sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
            const checkOut = dayAttendance.filter(a => a.type === 'check-out').sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

            return (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                key={report.id}
              >
                <Card className="overflow-hidden border border-slate-100 shadow-sm transition-all hover:shadow-md bg-white">
                  <CardContent className="p-0">
                    <div className="p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-full bg-yellow-400 text-black">
                            <Camera className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-bold text-lg uppercase tracking-tight truncate">{report.engineerName}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{report.clientName}</p>
                              {report.engineerRole && (
                                <Badge variant="outline" className="text-[7px] font-bold uppercase tracking-widest h-4 px-1.5 border-yellow-400 text-yellow-600">
                                  {report.engineerRole}
                                </Badge>
                              )}
                              {report.currentStage && (
                                <Badge className="text-[7px] font-bold uppercase tracking-widest h-4 px-1.5 bg-black text-yellow-400">
                                  {report.currentStage}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex flex-col items-end gap-1">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{safeFormat(report.timestamp, 'hh:mm a')}</p>
                          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                            {safeFormat(report.dateStr ? safeParseISO(report.dateStr) : report.timestamp, 'PPP')}
                          </p>
                          {(profile?.role === 'admin' || user?.email === 'vinita@reidiusinfra.com' || user?.email === 'vinitaagrawalec@gmail.com') && (
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-6 w-6 text-slate-300 hover:text-red-500"
                              onClick={() => {
                                onDelete(
                                  'Delete Report',
                                  'Are you sure you want to delete this site progress report? This action cannot be undone.',
                                  async () => {
                                    try {
                                      await deleteDoc(doc(db, 'site_reports', report.id));
                                    } catch (err) {
                                      handleFirestoreError(err, OperationType.DELETE, 'site_reports');
                                    }
                                  }
                                );
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Attendance Times for the Day */}
                      <div className="flex flex-wrap gap-4 py-2 border-y border-slate-50">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-500" />
                          <span className="text-[9px] font-bold uppercase text-slate-400 tracking-widest">Check In:</span>
                          <span className="text-[10px] font-bold text-slate-600">{checkIn ? safeFormat(checkIn.timestamp, 'hh:mm a') : 'N/A'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-red-500" />
                          <span className="text-[9px] font-bold uppercase text-slate-400 tracking-widest">Check Out:</span>
                          <span className="text-[10px] font-bold text-slate-600">{checkOut ? safeFormat(checkOut.timestamp, 'hh:mm a') : 'N/A'}</span>
                        </div>
                      </div>

                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                      {report.images.map((img, i) => (
                        <div key={i} className="aspect-square rounded-lg overflow-hidden border border-slate-100">
                          <img src={img} className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">AI Analysis Summary</p>
                      <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                        {report.aiAnalysis}
                      </div>
                    </div>

                    {report.nextStages && !(report.engineerRole === 'engineer' || report.engineerRole === 'site_supervisor') && (
                      <div className="p-4 bg-yellow-50/50 rounded-xl border border-yellow-100">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-yellow-600 mb-2">Next Working Stages</p>
                        <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed italic">
                          {report.nextStages}
                        </div>
                      </div>
                    )}

                    {report.labourEntries && report.labourEntries.length > 0 && (
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Available Labour</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {report.labourEntries.map((l, i) => (
                            <div key={i} className="text-[10px] bg-white p-2 rounded border border-slate-100 flex justify-between">
                              <span className="font-bold uppercase">{l.name} ({l.role})</span>
                              <span className="text-slate-500">{l.jobWork}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {report.safetyChecks && report.safetyChecks.length > 0 && (
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Safety Compliances</p>
                        <div className="flex flex-wrap gap-2">
                          {report.safetyChecks.map((s, i) => (
                            <span key={i} className="text-[9px] font-bold uppercase bg-green-100 text-green-700 px-2 py-1 rounded-full border border-green-200">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                      <MapPin className="h-3 w-3 text-yellow-500" />
                      <span>{report.location.latitude.toFixed(4)}, {report.location.longitude.toFixed(4)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })
      )}
      </div>
    </div>
  );
}

// --- Labour Report View ---
function LabourReportView({ siteReports }: { siteReports: SiteReport[] }) {
  const tradeRoles = ['electrician', 'plumber', 'flooring_team'];
  
  // Filter reports by trade roles and extract labour entries
  const labourData = siteReports
    .filter(report => tradeRoles.includes(report.engineerRole || ''))
    .flatMap(report => {
      const entries = report.labourEntries || [];
      return entries.map(entry => ({
        date: report.dateStr || safeFormat(report.timestamp, 'yyyy-MM-dd'),
        reportedBy: report.engineerName,
        role: report.engineerRole,
        client: report.clientName,
        labourName: entry.name,
        labourCount: entry.count,
        labourRole: entry.role,
        jobWork: entry.jobWork
      }));
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(labourData.map(item => ({
      'Date': item.date,
      'Site/Client': item.client,
      'Reported By': item.reportedBy,
      'Staff Role': item.role?.replace('_', ' ').toUpperCase(),
      'Labour Name': item.labourName,
      'Qty': item.labourCount,
      'Labour Type': item.labourRole,
      'Work Details': item.jobWork
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Labour Report");
    XLSX.writeFile(workbook, `Labour_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  // Group by date for display
  const groupedByDate = labourData.reduce((acc, curr) => {
    if (!acc[curr.date]) acc[curr.date] = [];
    acc[curr.date].push(curr);
    return acc;
  }, {} as Record<string, typeof labourData>);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold uppercase tracking-tight">Labour Report</h2>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Trade Team Labour Tracking</p>
        </div>
        <Button 
          onClick={exportToExcel}
          className="bg-green-600 hover:bg-green-700 text-white font-bold uppercase text-[10px] tracking-widest px-6"
        >
          <Download className="h-3.5 w-3.5 mr-2" />
          Export Excel
        </Button>
      </div>

      <div className="space-y-6">
        {Object.keys(groupedByDate).length === 0 ? (
          <Card className="p-16 text-center text-slate-300 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-10" />
            <p className="font-bold uppercase tracking-[0.2em] text-[10px]">No trade labour reported yet</p>
          </Card>
        ) : (
          Object.entries(groupedByDate).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()).map(([date, entries]) => (
            <div key={date} className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge className="bg-black text-yellow-400 font-bold uppercase tracking-widest text-[10px] px-3 py-1">
                  {format(parseISO(date), 'dd MMM yyyy')}
                </Badge>
                <div className="h-[1px] flex-1 bg-slate-100" />
              </div>
              
              <div className="grid grid-cols-1 gap-3">
                {entries.map((entry, idx) => (
                  <Card key={idx} className="border-slate-100 shadow-sm overflow-hidden">
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 flex-1">
                        <div className={cn(
                          "h-10 w-10 rounded-full flex items-center justify-center font-bold text-white uppercase",
                          entry.role === 'electrician' ? 'bg-orange-500' : 
                          entry.role === 'plumber' ? 'bg-cyan-500' : 'bg-emerald-500'
                        )}>
                          {entry.role?.[0]}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-tight">
                            {entry.labourName} <span className="text-yellow-600">x{entry.labourCount}</span> ({entry.labourRole})
                          </p>
                          <p className="text-[9px] text-slate-400 uppercase tracking-widest mt-0.5">
                            {entry.client} • Reported by {entry.reportedBy}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-bold uppercase text-slate-500 italic">
                          {entry.jobWork}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// --- Users View (Access Rights Management) ---
function UsersView({ users, currentProfile, isAdmin }: { users: UserProfile[], currentProfile: UserProfile | null, isAdmin: boolean }) {
  const [updating, setUpdating] = useState<string | null>(null);

  const handleRoleChange = async (uid: string, newRole: UserRole) => {
    setUpdating(uid);
    try {
      await updateDoc(doc(db, 'users', uid), { role: newRole });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'users');
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold uppercase tracking-tight">Access Management</h2>
        <Badge variant="outline" className="border-yellow-400 text-yellow-600 font-bold uppercase tracking-widest text-[8px]">Admin Only</Badge>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="hidden sm:block">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="hover:bg-transparent border-slate-100">
                <TableHead className="font-bold uppercase tracking-widest text-[10px] text-slate-500 py-5">User</TableHead>
                <TableHead className="font-bold uppercase tracking-widest text-[10px] text-slate-500">Email</TableHead>
                <TableHead className="font-bold uppercase tracking-widest text-[10px] text-slate-500">Current Role</TableHead>
                <TableHead className="font-bold uppercase tracking-widest text-[10px] text-slate-500 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.uid} className="border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <TableCell className="py-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8 border border-slate-100">
                        <AvatarFallback className="bg-slate-100 text-[10px] font-bold">{user.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <span className="font-bold text-sm uppercase tracking-tight">{user.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs font-medium text-slate-500">{user.email}</TableCell>
                  <TableCell>
                    <Badge className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 ${
                      user.role === 'admin' ? 'bg-black text-yellow-400' : 
                      user.role === 'qa' ? 'bg-blue-100 text-blue-700' :
                      user.role === 'site_supervisor' ? 'bg-purple-100 text-purple-700' :
                      user.role === 'electrician' ? 'bg-orange-100 text-orange-700' :
                      user.role === 'plumber' ? 'bg-cyan-100 text-cyan-700' :
                      user.role === 'flooring_team' ? 'bg-emerald-100 text-emerald-700' :
                      user.role === 'sales' ? 'bg-pink-100 text-pink-700' :
                      user.role === 'architect' ? 'bg-indigo-100 text-indigo-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {user.role?.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {user.uid === currentProfile?.uid ? (
                      <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Self</span>
                    ) : (
                      <Select 
                        disabled={updating === user.uid}
                        value={user.role} 
                        onValueChange={(value) => handleRoleChange(user.uid, value as UserRole)}
                      >
                        <SelectTrigger className="w-[120px] h-8 text-[10px] font-bold uppercase tracking-widest border-slate-200 ml-auto">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="engineer" className="text-[10px] font-bold uppercase tracking-widest">Engineer</SelectItem>
                          <SelectItem value="qa" className="text-[10px] font-bold uppercase tracking-widest">QA</SelectItem>
                          <SelectItem value="site_supervisor" className="text-[10px] font-bold uppercase tracking-widest">Site Supervisor</SelectItem>
                          <SelectItem value="electrician" className="text-[10px] font-bold uppercase tracking-widest">Electrician</SelectItem>
                          <SelectItem value="plumber" className="text-[10px] font-bold uppercase tracking-widest">Plumber</SelectItem>
                          <SelectItem value="flooring_team" className="text-[10px] font-bold uppercase tracking-widest">Flooring Team</SelectItem>
                          <SelectItem value="sales" className="text-[10px] font-bold uppercase tracking-widest">Sales</SelectItem>
                          <SelectItem value="architect" className="text-[10px] font-bold uppercase tracking-widest">Architect</SelectItem>
                          <SelectItem value="admin" className="text-[10px] font-bold uppercase tracking-widest">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile View for Users */}
        <div className="sm:hidden divide-y divide-slate-50">
          {users.map((user) => (
            <div key={user.uid} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8 border border-slate-100">
                    <AvatarFallback className="bg-slate-100 text-[10px] font-bold">{user.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-bold text-sm uppercase tracking-tight">{user.name}</p>
                    <p className="text-[10px] text-slate-400 font-medium">{user.email}</p>
                  </div>
                </div>
                <Badge className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 ${
                  user.role === 'admin' ? 'bg-black text-yellow-400' : 
                  user.role === 'qa' ? 'bg-blue-100 text-blue-700' :
                  user.role === 'site_supervisor' ? 'bg-purple-100 text-purple-700' :
                  user.role === 'electrician' ? 'bg-orange-100 text-orange-700' :
                  user.role === 'plumber' ? 'bg-cyan-100 text-cyan-700' :
                  user.role === 'flooring_team' ? 'bg-emerald-100 text-emerald-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {user.role?.replace('_', ' ')}
                </Badge>
              </div>
              <div className="flex justify-end">
                {user.uid === currentProfile?.uid ? (
                  <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Self</span>
                ) : (
                  <Select 
                    disabled={updating === user.uid}
                    value={user.role} 
                    onValueChange={(value) => handleRoleChange(user.uid, value as UserRole)}
                  >
                    <SelectTrigger className="w-full h-10 text-[10px] font-bold uppercase tracking-widest border-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="engineer" className="text-[10px] font-bold uppercase tracking-widest">Engineer</SelectItem>
                      <SelectItem value="qa" className="text-[10px] font-bold uppercase tracking-widest">QA</SelectItem>
                      <SelectItem value="site_supervisor" className="text-[10px] font-bold uppercase tracking-widest">Site Supervisor</SelectItem>
                      <SelectItem value="electrician" className="text-[10px] font-bold uppercase tracking-widest">Electrician</SelectItem>
                      <SelectItem value="plumber" className="text-[10px] font-bold uppercase tracking-widest">Plumber</SelectItem>
                      <SelectItem value="flooring_team" className="text-[10px] font-bold uppercase tracking-widest">Flooring Team</SelectItem>
                      <SelectItem value="admin" className="text-[10px] font-bold uppercase tracking-widest">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-6 bg-yellow-50 border border-yellow-100 rounded-2xl flex gap-4 items-start">
        <ShieldAlert className="h-5 w-5 text-yellow-600 mt-0.5" />
        <div>
          <p className="text-xs font-bold text-yellow-900 uppercase tracking-tight mb-1">Security Warning</p>
          <p className="text-[10px] text-yellow-700 leading-relaxed font-medium">
            Granting Admin access allows users to delete logs, manage clients, and change roles of other users. 
            Only promote trusted personnel to Admin status.
          </p>
        </div>
      </div>
    </div>
  );
}

// --- Live Status View ---
function LiveStatusView({ attendance, siteReports, clients }: { attendance: Attendance[], siteReports: SiteReport[], clients: Client[] }) {
  // Logic: Find the latest record for each person today.
  const today = format(new Date(), 'yyyy-MM-dd');
  
  // Group by engineerId from siteReports
  const latestReports: Record<string, SiteReport> = {};
  siteReports.filter(r => r.dateStr === today).forEach(report => {
    if (!latestReports[report.engineerId] || new Date(report.timestamp) > new Date(latestReports[report.engineerId].timestamp)) {
      latestReports[report.engineerId] = report;
    }
  });

  // Group by Client
  const groupedBySite: Record<string, any[]> = {};
  
  Object.values(latestReports).forEach(r => {
    const siteName = r.clientName || 'Unassigned Site';
    if (!groupedBySite[siteName]) groupedBySite[siteName] = [];
    
    // Find attendance for this user today
    const dayAttendance = attendance.filter(a => a.userId === r.engineerId && a.dateStr === today);
    const checkIn = dayAttendance.filter(a => a.type === 'check-in').sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
    const checkOut = dayAttendance.filter(a => a.type === 'check-out').sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    groupedBySite[siteName].push({
      id: r.id,
      name: r.engineerName,
      role: r.engineerRole || 'Engineer',
      timestamp: r.timestamp,
      aiAnalysis: r.aiAnalysis,
      images: r.images,
      checkIn: checkIn ? safeFormat(checkIn.timestamp, 'hh:mm a') : 'N/A',
      checkOut: checkOut ? safeFormat(checkOut.timestamp, 'hh:mm a') : 'N/A'
    });
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold uppercase tracking-tight">Current Site Status</h2>
        <Badge className="bg-green-100 text-green-700 border-green-200 font-bold uppercase text-[10px] tracking-widest px-3 py-1">
          Live Now
        </Badge>
      </div>

      {Object.keys(groupedBySite).length === 0 ? (
        <Card className="p-16 text-center text-slate-300 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
          <Users className="h-12 w-12 mx-auto mb-4 opacity-10" />
          <p className="font-bold uppercase tracking-[0.2em] text-[10px]">No site reports submitted today</p>
        </Card>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedBySite).map(([siteName, reports]) => (
            <div key={siteName} className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <h3 className="font-bold uppercase tracking-widest text-xs text-slate-500">{siteName}</h3>
                <Badge variant="outline" className="text-[8px] font-bold">{reports.length} Staff Active</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {reports.map((report) => (
                  <Card key={report.id} className="border border-slate-100 shadow-sm overflow-hidden">
                    <CardContent className="p-4 space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-yellow-400 flex items-center justify-center border border-yellow-500 text-black">
                          <Camera className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm uppercase tracking-tight truncate">{report.name}</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                            {report.role} • {safeFormat(report.timestamp, 'hh:mm a')}
                          </p>
                          <div className="flex gap-3 mt-1">
                            <p className="text-[8px] font-bold text-green-600 uppercase tracking-widest">IN: {report.checkIn}</p>
                            <p className="text-[8px] font-bold text-red-600 uppercase tracking-widest">OUT: {report.checkOut}</p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-1">Latest AI Summary</p>
                        <p className="text-[10px] text-slate-600 line-clamp-3 leading-relaxed">{report.aiAnalysis}</p>
                      </div>

                      <div className="flex gap-1 overflow-x-auto pb-1">
                        {report.images.map((img: string, i: number) => (
                          <div key={i} className="h-10 w-10 rounded border border-slate-100 flex-shrink-0 overflow-hidden">
                            <img src={img} className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectStatusView({ clients, siteReports }: { clients: Client[], siteReports: SiteReport[] }) {
  const [activeStageTab, setActiveStageTab] = useState('all');
  
  const sortedStages = ['all', ...CONSTRUCTION_STAGES];

  const filteredClients = activeStageTab === 'all' 
    ? clients 
    : clients.filter(c => c.currentStage === activeStageTab);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-heading font-bold uppercase tracking-tight">Project Status</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">AI-Driven Stage Identification</p>
        </div>
        <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 font-bold uppercase text-[10px] tracking-widest px-3 py-1 w-fit">
          {clients.length} Active Projects
        </Badge>
      </div>

      <div className="flex flex-col space-y-2">
        <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Filter by Project Stage</Label>
        <Select value={activeStageTab} onValueChange={setActiveStageTab}>
          <SelectTrigger className="h-12 border-slate-200 font-medium bg-white">
            <SelectValue placeholder="Select a stage" />
          </SelectTrigger>
          <SelectContent>
            {sortedStages.map((stage) => (
              <SelectItem key={stage} value={stage} className="font-medium">
                {stage === 'all' ? 'All Stages' : stage}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredClients.length === 0 ? (
        <Card className="p-16 text-center text-slate-300 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
          <ClipboardCheck className="h-12 w-12 mx-auto mb-4 opacity-10" />
          <p className="font-bold uppercase tracking-[0.2em] text-[10px]">No projects in this stage</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredClients.map((client) => {
            const clientReports = siteReports.filter(r => r.clientId === client.id);
            const latestReport = clientReports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
            
            return (
              <Card key={client.id} className="border border-slate-100 shadow-sm overflow-hidden bg-white hover:shadow-md transition-all group">
                <CardHeader className="bg-slate-50/50 border-b border-slate-100 p-4 group-hover:bg-slate-100/50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg font-bold uppercase tracking-tight">{client.name}</CardTitle>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                        Registered: {safeFormat(client.createdAt, 'MMM dd, yyyy')}
                      </p>
                    </div>
                    <Badge className={cn(
                      "font-bold uppercase text-[9px] tracking-widest px-2 py-0.5",
                      client.currentStage ? "bg-black text-yellow-400" : "bg-slate-200 text-slate-500"
                    )}>
                      {client.currentStage || 'Not Started'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  {latestReport ? (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Progress Status</p>
                          <p className="text-[10px] font-bold text-black">
                            {Math.round(((CONSTRUCTION_STAGES.indexOf(client.currentStage as any) + 1) / CONSTRUCTION_STAGES.length) * 100)}%
                          </p>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${((CONSTRUCTION_STAGES.indexOf(client.currentStage as any) + 1) / CONSTRUCTION_STAGES.length) * 100}%` }}
                            className="h-full bg-yellow-400"
                          />
                        </div>
                      </div>

                      <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 group-hover:bg-white transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Latest AI Summary</p>
                          <p className="text-[8px] font-bold text-slate-400">{safeFormat(latestReport.timestamp, 'MMM dd, hh:mm a')}</p>
                        </div>
                        <p className="text-[10px] text-slate-600 line-clamp-4 leading-relaxed italic">
                          "{latestReport.aiAnalysis.substring(0, 200)}..."
                        </p>
                      </div>

                      <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest pt-2 border-t border-slate-50">
                        <span className="text-slate-400 flex items-center gap-1">
                          <Users className="h-3 w-3" /> {latestReport.engineerName}
                        </span>
                        <span className="text-yellow-600 flex items-center gap-1">
                          <ClipboardCheck className="h-3 w-3" /> {clientReports.length} Reports
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="py-8 text-center space-y-2">
                      <AlertTriangle className="h-8 w-8 mx-auto text-slate-200" />
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">No reports submitted for this site</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Safety View (Admin Management) ---
function SafetyView({ safetyChecks, isAdmin, onDelete }: { safetyChecks: SafetyCheck[], isAdmin: boolean, onDelete: (title: string, description: string, onConfirm: () => Promise<void>) => void }) {
  const [newTask, setNewTask] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAddTask = async () => {
    if (!newTask.trim()) return;
    try {
      await addDoc(collection(db, 'safety_checkpoints'), {
        task: newTask.trim(),
        createdAt: serverTimestamp()
      });
      setNewTask('');
      setIsAdding(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'safety_checkpoints');
    }
  };

  const handleDeleteTask = async (id: string) => {
    onDelete(
      'Delete Safety Checkpoint',
      'Are you sure you want to delete this safety checkpoint?',
      async () => {
        try {
          await deleteDoc(doc(db, 'safety_checkpoints', id));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, 'safety_checkpoints');
        }
      }
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold uppercase tracking-tight">Safety Checkpoints</h2>
        {isAdmin && (
          <Dialog open={isAdding} onOpenChange={setIsAdding}>
            <DialogTrigger render={
              <Button className="bg-black text-yellow-400 hover:bg-slate-800 border border-yellow-400 font-bold uppercase text-[10px] tracking-widest px-6">
                <Plus className="h-3.5 w-3.5 mr-2" />
                Add Checkpoint
              </Button>
            } />
            <DialogContent className="sm:max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl">
              <DialogHeader>
                <DialogTitle className="text-2xl font-heading font-bold uppercase tracking-tight">New Safety Task</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 py-4">
                <div className="space-y-2">
                  <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Task Description</Label>
                  <Input 
                    value={newTask} 
                    onChange={e => setNewTask(e.target.value)} 
                    placeholder="e.g., Wearing Helmet & Safety Vest"
                    className="border-slate-200 h-12 font-medium focus:border-yellow-400 transition-all" 
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleAddTask} className="w-full h-14 bg-yellow-400 text-black hover:bg-yellow-500 font-bold uppercase tracking-widest shadow-sm">
                  Add Task
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {safetyChecks.length === 0 ? (
          <div className="py-20 text-center text-slate-300 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
            <ShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-10" />
            <p className="font-bold uppercase tracking-[0.2em] text-[10px]">No safety checkpoints defined</p>
          </div>
        ) : (
          safetyChecks.map((check) => (
            <Card key={check.id} className="border border-slate-100 shadow-sm">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-yellow-100 p-2 rounded-lg">
                    <CheckSquare className="h-4 w-4 text-yellow-700" />
                  </div>
                  <span className="font-bold text-sm uppercase tracking-tight">{check.task}</span>
                </div>
                {isAdmin && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => handleDeleteTask(check.id)}
                    className="text-slate-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// --- Visits View ---
function VisitsView({ siteReports, allUsers, attendance }: { siteReports: SiteReport[], allUsers: UserProfile[], attendance: Attendance[] }) {
  const [viewMode, setViewMode] = useState<'today' | 'all'>('today');
  const today = format(new Date(), 'yyyy-MM-dd');
  
  const todayReports = siteReports.filter(r => r.dateStr === today);

  const engineerVisits = allUsers
    .filter(u => ['engineer', 'qa', 'site_supervisor', 'electrician', 'plumber', 'flooring_team'].includes(u.role))
    .map(eng => {
      const visits = todayReports.filter(r => r.engineerId === eng.uid);
      const dayAttendance = attendance.filter(a => a.userId === eng.uid && a.dateStr === today);
      const checkIn = dayAttendance.filter(a => a.type === 'check-in').sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
      const checkOut = dayAttendance.filter(a => a.type === 'check-out').sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

      return {
        uid: eng.uid,
        name: eng.name,
        email: eng.email,
        role: eng.role,
        clients: visits.map(v => v.clientName).join(', '),
        count: visits.length,
        times: visits.map(v => format(new Date(v.timestamp), 'hh:mm a')).join(', '),
        checkIn: checkIn ? safeFormat(checkIn.timestamp, 'hh:mm a') : 'N/A',
        checkOut: checkOut ? safeFormat(checkOut.timestamp, 'hh:mm a') : 'N/A'
      };
    });

  const exportTodayToExcel = () => {
    const data = engineerVisits.map(v => ({
      'Date': today,
      'Staff Name': v.name,
      'Email': v.email,
      'Role': allUsers.find(u => u.uid === v.uid)?.role || 'N/A',
      'Check In': v.checkIn,
      'Check Out': v.checkOut,
      'Clients Visited Today': v.clients || 'None',
      'Visit Times': v.times || 'N/A',
      'Total Visits': v.count
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Daily Visits");
    XLSX.writeFile(workbook, `Engineer_Visits_${today}.xlsx`);
  };

  const exportAllHistoryToExcel = () => {
    const data = [...siteReports]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .map(r => {
        const reportDate = r.dateStr || safeFormat(r.timestamp, 'yyyy-MM-dd');
        const dayAttendance = attendance.filter(a => a.userId === r.engineerId && a.dateStr === reportDate);
        const checkIn = dayAttendance.filter(a => a.type === 'check-in').sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
        const checkOut = dayAttendance.filter(a => a.type === 'check-out').sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

        return {
          'Date': r.dateStr,
          'Time': format(new Date(r.timestamp), 'hh:mm a'),
          'Staff Name': r.engineerName,
          'Role': allUsers.find(u => u.uid === r.engineerId)?.role || 'N/A',
          'Check In': checkIn ? safeFormat(checkIn.timestamp, 'hh:mm a') : 'N/A',
          'Check Out': checkOut ? safeFormat(checkOut.timestamp, 'hh:mm a') : 'N/A',
          'Client Name': r.clientName,
          'AI Analysis Summary': r.aiAnalysis?.substring(0, 200) + '...'
        };
      });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "All Visits History");
    XLSX.writeFile(workbook, `All_Engineer_Visits_History_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-heading font-bold uppercase tracking-tight">Site Visits</h2>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Engineer-wise Site Visit Summary</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button 
            onClick={exportTodayToExcel}
            className="bg-green-600 text-white hover:bg-green-700 font-bold uppercase text-[10px] tracking-widest px-4 h-10"
          >
            <Download className="h-3.5 w-3.5 mr-2" />
            Export Today
          </Button>
          <Button 
            onClick={exportAllHistoryToExcel}
            className="bg-blue-600 text-white hover:bg-blue-700 font-bold uppercase text-[10px] tracking-widest px-4 h-10"
          >
            <Download className="h-3.5 w-3.5 mr-2" />
            Export All History
          </Button>
        </div>
      </div>

      <div className="bg-slate-50 p-1 rounded-xl inline-flex mb-4">
        <Button 
          variant={viewMode === 'today' ? 'default' : 'ghost'}
          onClick={() => setViewMode('today')}
          className={cn(
            "h-9 px-6 rounded-lg font-bold uppercase text-[10px] tracking-widest",
            viewMode === 'today' ? "bg-white text-black shadow-sm" : "text-slate-500"
          )}
        >
          Today's Summary
        </Button>
        <Button 
          variant={viewMode === 'all' ? 'default' : 'ghost'}
          onClick={() => setViewMode('all')}
          className={cn(
            "h-9 px-6 rounded-lg font-bold uppercase text-[10px] tracking-widest",
            viewMode === 'all' ? "bg-white text-black shadow-sm" : "text-slate-500"
          )}
        >
          All History
        </Button>
      </div>

      <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
        {viewMode === 'today' ? (
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-500 py-4">Staff Member</TableHead>
                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-500 py-4">Check In</TableHead>
                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-500 py-4">Check Out</TableHead>
                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-500 py-4">Clients Visited Today</TableHead>
                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-500 py-4 text-center">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {engineerVisits.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-20 text-center text-slate-300">
                    <MapPin className="h-12 w-12 mx-auto mb-4 opacity-10" />
                    <p className="font-bold uppercase tracking-[0.2em] text-[10px]">No engineers found</p>
                  </TableCell>
                </TableRow>
              ) : (
                engineerVisits.map((eng, idx) => (
                  <TableRow key={idx} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-bold text-sm uppercase tracking-tight py-4">
                      <div>{eng.name}</div>
                      <div className="text-[10px] text-slate-400 font-normal lowercase">{eng.email}</div>
                      <Badge variant="outline" className="text-[7px] font-bold uppercase tracking-tighter mt-1 h-4 px-1 border-slate-200 text-slate-400">
                        {eng.role || 'engineer'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-bold text-[10px] text-green-600 py-4">{eng.checkIn}</TableCell>
                    <TableCell className="font-bold text-[10px] text-red-600 py-4">{eng.checkOut}</TableCell>
                    <TableCell className="text-sm text-slate-600 py-4">
                      {eng.clients ? (
                        <div className="space-y-1">
                          <div className="font-medium">{eng.clients}</div>
                          <div className="text-[10px] text-slate-400 italic">Times: {eng.times}</div>
                        </div>
                      ) : (
                        <span className="text-slate-300 italic">No visits recorded today</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center py-4">
                      <Badge variant={eng.count > 0 ? "default" : "outline"} className={cn(
                        "font-bold",
                        eng.count > 0 ? "bg-blue-100 text-blue-700 hover:bg-blue-100 border-none" : "text-slate-300 border-slate-100"
                      )}>
                        {eng.count}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-500 py-4">Date</TableHead>
                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-500 py-4">Staff Member</TableHead>
                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-500 py-4">Check In</TableHead>
                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-500 py-4">Check Out</TableHead>
                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-500 py-4">Client / Site</TableHead>
                <TableHead className="font-bold uppercase text-[10px] tracking-widest text-slate-500 py-4">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {siteReports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-20 text-center text-slate-300">
                    <MapPin className="h-12 w-12 mx-auto mb-4 opacity-10" />
                    <p className="font-bold uppercase tracking-[0.2em] text-[10px]">No visit history found</p>
                  </TableCell>
                </TableRow>
              ) : (
                [...siteReports]
                  .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
                  .map((report, idx) => {
                    const reportDate = report.dateStr || safeFormat(report.timestamp, 'yyyy-MM-dd');
                    const dayAttendance = attendance.filter(a => a.userId === report.engineerId && a.dateStr === reportDate);
                    const checkIn = dayAttendance.filter(a => a.type === 'check-in').sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
                    const checkOut = dayAttendance.filter(a => a.type === 'check-out').sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

                    return (
                      <TableRow key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <TableCell className="font-bold text-[10px] uppercase tracking-widest py-4">
                          {report.dateStr}
                        </TableCell>
                        <TableCell className="font-bold text-sm uppercase tracking-tight py-4">
                          {report.engineerName}
                        </TableCell>
                        <TableCell className="font-bold text-[10px] text-green-600 py-4">
                          {checkIn ? safeFormat(checkIn.timestamp, 'hh:mm a') : 'N/A'}
                        </TableCell>
                        <TableCell className="font-bold text-[10px] text-red-600 py-4">
                          {checkOut ? safeFormat(checkOut.timestamp, 'hh:mm a') : 'N/A'}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600 py-4">
                          {report.clientName}
                        </TableCell>
                        <TableCell className="text-[10px] text-slate-400 py-4">
                          {format(new Date(report.timestamp), 'hh:mm a')}
                        </TableCell>
                      </TableRow>
                    );
                  })
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// --- Report Heads View (Admin Management) ---
function ReportHeadsView({ reportHeads, isAdmin, onDelete }: { reportHeads: ReportHead[], isAdmin: boolean, onDelete: (title: string, description: string, onConfirm: () => Promise<void>) => void }) {
  const [newHead, setNewHead] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('engineer');
  const [isAdding, setIsAdding] = useState(false);
  const [editingHead, setEditingHead] = useState<ReportHead | null>(null);

  const handleAddHead = async () => {
    if (!newHead.trim()) return;
    try {
      await addDoc(collection(db, 'report_heads'), {
        title: newHead.trim(),
        role: newRole,
        createdAt: serverTimestamp()
      });
      setNewHead('');
      setNewRole('engineer');
      setIsAdding(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'report_heads');
    }
  };

  const handleUpdateHead = async () => {
    if (!editingHead || !editingHead.title.trim()) return;
    try {
      await updateDoc(doc(db, 'report_heads', editingHead.id), {
        title: editingHead.title.trim(),
        role: editingHead.role
      });
      setEditingHead(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'report_heads');
    }
  };

  const handleDeleteHead = async (id: string) => {
    onDelete(
      'Delete Report Head',
      'Are you sure you want to delete this AI report technical head?',
      async () => {
        try {
          await deleteDoc(doc(db, 'report_heads', id));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, 'report_heads');
        }
      }
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold uppercase tracking-tight">AI Report Heads</h2>
        {isAdmin && (
          <Dialog open={isAdding} onOpenChange={setIsAdding}>
            <DialogTrigger render={
              <Button className="bg-black text-yellow-400 hover:bg-slate-800 border border-yellow-400 font-bold uppercase text-[10px] tracking-widest px-6">
                <Plus className="h-3.5 w-3.5 mr-2" />
                Add Head
              </Button>
            } />
            <DialogContent className="sm:max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl">
              <DialogHeader>
                <DialogTitle className="text-2xl font-heading font-bold uppercase tracking-tight">New Technical Head</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 py-4">
                <div className="space-y-2">
                  <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Head Title</Label>
                  <Input 
                    value={newHead} 
                    onChange={e => setNewHead(e.target.value)} 
                    placeholder="e.g., Brickwork Progress, Electrical Conduit Status"
                    className="border-slate-200 h-12 font-medium focus:border-yellow-400 transition-all" 
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Applicable Role</Label>
                  <Select value={newRole} onValueChange={(v) => setNewRole(v as UserRole)}>
                    <SelectTrigger className="h-12 border-slate-200 font-medium focus:border-yellow-400">
                      <SelectValue placeholder="Select Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="engineer">Engineer</SelectItem>
                      <SelectItem value="qa">QA</SelectItem>
                      <SelectItem value="site_supervisor">Site Supervisor</SelectItem>
                      <SelectItem value="electrician">Electrician</SelectItem>
                      <SelectItem value="plumber">Plumber</SelectItem>
                      <SelectItem value="flooring_team">Flooring Team</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button 
                  onClick={handleAddHead} 
                  disabled={!newHead.trim()}
                  className="w-full h-14 bg-yellow-400 text-black hover:bg-yellow-500 font-bold uppercase tracking-widest shadow-sm disabled:opacity-50"
                >
                  Add Head
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {reportHeads.length === 0 ? (
          <div className="py-20 text-center text-slate-300 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
            <ClipboardList className="h-12 w-12 mx-auto mb-4 opacity-10" />
            <p className="font-bold uppercase tracking-[0.2em] text-[10px]">No technical heads defined</p>
          </div>
        ) : (
          reportHeads.map((head) => (
            <Card key={head.id} className="border border-slate-100 shadow-sm">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 p-2 rounded-lg">
                    <FileText className="h-4 w-4 text-blue-700" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-bold text-sm uppercase tracking-tight">{head.title}</span>
                    <Badge variant="outline" className="w-fit text-[8px] font-bold uppercase tracking-widest mt-1">
                      {head.role || 'engineer'}
                    </Badge>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <Dialog open={!!editingHead && editingHead.id === head.id} onOpenChange={(open) => !open && setEditingHead(null)}>
                      <DialogTrigger render={
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => setEditingHead(head)}
                          className="text-slate-300 hover:text-blue-500 transition-colors"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      } />
                      <DialogContent className="sm:max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl">
                        <DialogHeader>
                          <DialogTitle className="text-2xl font-heading font-bold uppercase tracking-tight">Edit Technical Head</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-5 py-4">
                          <div className="space-y-2">
                            <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Head Title</Label>
                            <Input 
                              value={editingHead?.title || ''} 
                              onChange={e => setEditingHead(prev => prev ? {...prev, title: e.target.value} : null)} 
                              className="border-slate-200 h-12 font-medium focus:border-yellow-400 transition-all" 
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Applicable Role</Label>
                            <Select value={editingHead?.role || 'engineer'} onValueChange={(v) => setEditingHead(prev => prev ? {...prev, role: v as UserRole} : null)}>
                              <SelectTrigger className="h-12 border-slate-200 font-medium focus:border-yellow-400">
                                <SelectValue placeholder="Select Role" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="engineer">Engineer</SelectItem>
                                <SelectItem value="qa">QA</SelectItem>
                                <SelectItem value="site_supervisor">Site Supervisor</SelectItem>
                                <SelectItem value="electrician">Electrician</SelectItem>
                                <SelectItem value="plumber">Plumber</SelectItem>
                                <SelectItem value="flooring_team">Flooring Team</SelectItem>
                                <SelectItem value="sales">Sales</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button 
                            onClick={handleUpdateHead} 
                            disabled={!editingHead?.title.trim()}
                            className="w-full h-14 bg-yellow-400 text-black hover:bg-yellow-500 font-bold uppercase tracking-widest shadow-sm disabled:opacity-50"
                          >
                            Update Head
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => handleDeleteHead(head.id)}
                      className="text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// --- Clients View ---
function ClientsView({ 
  clients, 
  isAdmin,
  currentLocation,
  onDelete,
  onSync
}: { 
  clients: Client[], 
  isAdmin: boolean,
  currentLocation: { latitude: number, longitude: number } | null,
  onDelete: (title: string, description: string, onConfirm: () => Promise<void>) => void,
  onSync: () => Promise<void>
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [newClient, setNewClient] = useState({ 
    name: '', 
    latitude: '',
    longitude: '',
    geoFenceRadius: '20'
  });
  const [editForm, setEditForm] = useState({
    name: '',
    latitude: '',
    longitude: '',
    geoFenceRadius: '20'
  });

  const handleAddClient = async () => {
    if (!newClient.name) return;
    
    try {
      const clientData: any = {
        name: newClient.name,
        createdAt: serverTimestamp()
      };

      if (newClient.latitude && newClient.longitude) {
        clientData.siteLocation = {
          latitude: parseFloat(newClient.latitude),
          longitude: parseFloat(newClient.longitude)
        };
      }

      if (newClient.geoFenceRadius) {
        clientData.geoFenceRadius = parseFloat(newClient.geoFenceRadius);
      }

      await addDoc(collection(db, 'clients'), clientData);
      setNewClient({ name: '', latitude: '', longitude: '', geoFenceRadius: '20' });
      setIsAdding(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'clients');
    }
  };

  const handleUpdateClient = async () => {
    if (!editingClient || !editForm.name) return;

    try {
      const updateData: any = {
        name: editForm.name
      };

      if (editForm.latitude && editForm.longitude) {
        updateData.siteLocation = {
          latitude: parseFloat(editForm.latitude),
          longitude: parseFloat(editForm.longitude)
        };
      } else {
        updateData.siteLocation = deleteField();
      }

      if (editForm.geoFenceRadius) {
        updateData.geoFenceRadius = parseFloat(editForm.geoFenceRadius);
      }

      await updateDoc(doc(db, 'clients', editingClient.id), updateData);
      setEditingClient(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `clients/${editingClient.id}`);
    }
  };

  const getCurrentLocation = (isEdit: boolean = false) => {
    if (currentLocation) {
      if (isEdit) {
        setEditForm({
          ...editForm,
          latitude: currentLocation.latitude.toString(),
          longitude: currentLocation.longitude.toString()
        });
      } else {
        setNewClient({
          ...newClient,
          latitude: currentLocation.latitude.toString(),
          longitude: currentLocation.longitude.toString()
        });
      }
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        if (isEdit) {
          setEditForm({
            ...editForm,
            latitude: position.coords.latitude.toString(),
            longitude: position.coords.longitude.toString()
          });
        } else {
          setNewClient({
            ...newClient,
            latitude: position.coords.latitude.toString(),
            longitude: position.coords.longitude.toString()
          });
        }
      });
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold uppercase tracking-tight">Client Directory</h2>
        <div className="flex items-center gap-4">
          {isAdmin && (
            <Button 
              variant="outline" 
              onClick={onSync}
              className="text-[10px] font-bold uppercase tracking-widest border-slate-200 h-10"
            >
              Sync Hardcoded List
            </Button>
          )}
          {isAdmin && (
            <Dialog open={isAdding} onOpenChange={setIsAdding}>
            <DialogTrigger render={
              <Button className="bg-black text-yellow-400 hover:bg-slate-800 border border-yellow-400 font-bold uppercase text-[10px] tracking-widest px-6">
                <UserPlus className="h-3.5 w-3.5 mr-2" />
                Register Client
              </Button>
            } />
            <DialogContent className="sm:max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl">
              <DialogHeader>
                <DialogTitle className="text-2xl font-heading font-bold uppercase tracking-tight">New Client Registration</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 py-4">
                <div className="space-y-2">
                  <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Client Name / Site Name</Label>
                  <Input value={newClient.name} onChange={e => setNewClient({...newClient, name: e.target.value})} className="border-slate-200 h-12 font-medium focus:border-yellow-400 transition-all" />
                </div>
                <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Site Location (GPS) - Optional</Label>
                    <Button variant="ghost" size="sm" onClick={getCurrentLocation} className="h-7 text-[9px] font-bold uppercase tracking-widest text-yellow-600 hover:text-yellow-700">
                      <MapPin className="h-3 w-3 mr-1" />
                      Get Current
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Input placeholder="Latitude" value={newClient.latitude} onChange={e => setNewClient({...newClient, latitude: e.target.value})} className="border-slate-200 h-10 text-xs font-medium" />
                    <Input placeholder="Longitude" value={newClient.longitude} onChange={e => setNewClient({...newClient, longitude: e.target.value})} className="border-slate-200 h-10 text-xs font-medium" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Geo-Fence Radius (Meters)</Label>
                  <Input type="number" value={newClient.geoFenceRadius} onChange={e => setNewClient({...newClient, geoFenceRadius: e.target.value})} className="border-slate-200 h-12 font-medium focus:border-yellow-400 transition-all" />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleAddClient} className="w-full h-14 bg-yellow-400 text-black hover:bg-yellow-500 font-bold uppercase tracking-widest shadow-sm">
                  Register Client
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {isAdmin && (
          <Card 
            className="overflow-hidden border-2 border-dashed border-yellow-400/50 bg-yellow-400/5 hover:bg-yellow-400/10 hover:border-yellow-400 transition-all cursor-pointer flex flex-col items-center justify-center p-8 text-center"
            onClick={() => setIsAdding(true)}
          >
            <div className="bg-yellow-400 p-4 rounded-full mb-4 shadow-lg group-hover:scale-110 transition-transform">
              <Plus className="h-8 w-8 text-black" />
            </div>
            <p className="font-heading font-bold text-lg uppercase tracking-tight text-slate-900 border-b-2 border-yellow-400 pb-1 mb-2">Register New Client</p>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Setup a new construction site</p>
          </Card>
        )}
        {clients.length === 0 && !isAdmin ? (
          <div className="col-span-full py-20 text-center text-slate-300 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-10" />
            <p className="font-bold uppercase tracking-[0.2em] text-[10px]">No clients registered yet</p>
          </div>
        ) : (
          clients.map((client) => (
            <Card key={client.id} className="overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-all group">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="font-bold text-lg uppercase tracking-tight truncate">{client.name}</p>
                    <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mt-1">
                      <Clock className="h-3 w-3" />
                      <span>Registered {safeFormat(client.createdAt, 'MMM yyyy')}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => {
                            setEditingClient(client);
                            setEditForm({
                              name: client.name,
                              latitude: client.siteLocation?.latitude.toString() || '',
                              longitude: client.siteLocation?.longitude.toString() || '',
                              geoFenceRadius: client.geoFenceRadius?.toString() || '20'
                            });
                          }}
                          className="h-8 w-8 text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => {
                            onDelete(
                              'Delete Client',
                              `Are you sure you want to delete ${client.name}? This will remove the client and all associated site data.`,
                              async () => {
                                try {
                                  await deleteDoc(doc(db, 'clients', client.id));
                                } catch (err) {
                                  handleFirestoreError(err, OperationType.DELETE, 'clients');
                                }
                              }
                            );
                          }}
                          className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                    <Badge className="bg-slate-50 text-slate-600 border border-slate-100 text-[8px] font-bold uppercase tracking-widest px-2 py-0.5">Client Site</Badge>
                  </div>
                </div>
                <div className="space-y-3">
                  {client.siteLocation && (
                    <div className="flex items-center gap-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 p-2 rounded-lg">
                      <MapPin className="h-3 w-3 text-yellow-500" />
                      <span>{client.siteLocation.latitude.toFixed(4)}, {client.siteLocation.longitude.toFixed(4)}</span>
                      {client.geoFenceRadius && <span className="ml-auto text-yellow-600">Radius: {client.geoFenceRadius}m</span>}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Edit Client Dialog */}
      <Dialog open={!!editingClient} onOpenChange={(open) => !open && setEditingClient(null)}>
        <DialogContent className="sm:max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-heading font-bold uppercase tracking-tight">Edit Client Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Client Name / Site Name</Label>
              <Input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} className="border-slate-200 h-12 font-medium focus:border-yellow-400 transition-all" />
            </div>
            <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center justify-between">
                <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Site Location (GPS)</Label>
                <Button variant="ghost" size="sm" onClick={() => getCurrentLocation(true)} className="h-7 text-[9px] font-bold uppercase tracking-widest text-yellow-600 hover:text-yellow-700">
                  <MapPin className="h-3 w-3 mr-1" />
                  Get Current
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input placeholder="Latitude" value={editForm.latitude} onChange={e => setEditForm({...editForm, latitude: e.target.value})} className="border-slate-200 h-10 text-xs font-medium" />
                <Input placeholder="Longitude" value={editForm.longitude} onChange={e => setEditForm({...editForm, longitude: e.target.value})} className="border-slate-200 h-10 text-xs font-medium" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Geo-Fence Radius (Meters)</Label>
              <Input type="number" value={editForm.geoFenceRadius} onChange={e => setEditForm({...editForm, geoFenceRadius: e.target.value})} className="border-slate-200 h-12 font-medium focus:border-yellow-400 transition-all" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleUpdateClient} className="w-full h-14 bg-yellow-400 text-black hover:bg-yellow-500 font-bold uppercase tracking-widest shadow-sm">
              Update Client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Reports View ---
function ReportsView({ 
  attendance, 
  siteReports, 
  isAdmin, 
  profile,
  clients,
  onDelete 
}: { 
  attendance: Attendance[], 
  siteReports: SiteReport[], 
  isAdmin: boolean, 
  profile: UserProfile | null,
  clients: Client[],
  onDelete: (title: string, description: string, onConfirm: () => Promise<void>) => void
}) {
  const [filterDate, setFilterDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [filterSite, setFilterSite] = useState<string>('all');
  const [filterStaff, setFilterStaff] = useState<string>('all');

  const staffMembers = Array.from(new Set(siteReports.map(r => JSON.stringify({id: r.engineerId, name: r.engineerName}))))
    .map(s => JSON.parse(s) as {id: string, name: string})
    .sort((a, b) => a.name.localeCompare(b.name));

  const filteredReports = siteReports.filter(r => {
    const dateMatch = r.dateStr === filterDate;
    const siteMatch = filterSite === 'all' || r.clientId === filterSite;
    const staffMatch = filterStaff === 'all' || r.engineerId === filterStaff;
    return dateMatch && siteMatch && staffMatch;
  });

  const downloadPDF = () => {
    try {
      if (filteredReports.length === 0) {
        alert('No reports found for the selected criteria.');
        return;
      }

      // Initialize jsPDF
      const doc = new jsPDF();
      const siteLabel = filterSite === 'all' ? 'All Sites' : clients.find(c => c.id === filterSite)?.name || 'Unknown Site';
      
      let parsedFilterDate: Date;
      try {
        parsedFilterDate = parseISO(filterDate);
        if (isNaN(parsedFilterDate.getTime())) throw new Error('Invalid date');
      } catch (e) {
        parsedFilterDate = new Date();
      }
      
      // Helper for Header
      const addHeader = (d: jsPDF, pageNum: number) => {
        try {
          // Header Background
          d.setFillColor(248, 250, 252);
          d.rect(0, 0, 210, 35, 'F');
          
          d.setFontSize(18);
          d.setFont('helvetica', 'bold');
          d.setTextColor(30, 58, 138); // Professional Navy Blue
          d.text('REIDIUS INFRA PRIVATE LIMITED', 14, 18);
          
          d.setFontSize(8);
          d.setFont('helvetica', 'normal');
          d.setTextColor(71, 85, 105); // Slate Grey
          d.text('DAILY SITE PROGRESS REPORT', 14, 26);
          
          d.setFontSize(9);
          d.text(`DATE: ${format(parsedFilterDate, 'PPP')}`, 140, 12);
          d.text(`TIME: ${format(new Date(), 'hh:mm a')}`, 140, 18);
          d.text(`SITE: ${siteLabel.toUpperCase()}`, 140, 24);
          d.text(`PAGE: ${pageNum}`, 140, 30);
        } catch (e) {
          console.error('Header error:', e);
        }
      };

      let currentY = 45;
      addHeader(doc, 1);

      filteredReports.forEach((report, index) => {
        // Check for page break before each report
        if (currentY > 230) {
          doc.addPage();
          addHeader(doc, doc.getNumberOfPages());
          currentY = 45;
        }

        // Report Metadata Header
        doc.setFillColor(245, 245, 245);
        doc.rect(14, currentY, 182, 14, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        doc.text(`CLIENT: ${report.clientName.toUpperCase()}`, 18, currentY + 9);
        
        let reportTime = 'N/A';
        let reportDateDisplay = 'N/A';
        try {
          reportTime = safeFormat(report.timestamp, 'hh:mm a');
          reportDateDisplay = safeFormat(report.dateStr ? safeParseISO(report.dateStr) : report.timestamp, 'PPP');
        } catch (e) {}
        doc.setFontSize(9);
        const roleStr = report.engineerRole ? ` (${report.engineerRole.toUpperCase()})` : '';
        const metaText = `DATE: ${reportDateDisplay}  |  TIME: ${reportTime}  |  STAFF: ${report.engineerName.toUpperCase()}${roleStr}`;
        doc.text(metaText, 196, currentY + 9, { align: 'right' });
        currentY += 20;

        // AI Analysis
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text('1. WORK SUMMARY & OBSERVATIONS:', 14, currentY);
        currentY += 10;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setLineHeightFactor(1.5);
        const splitText = doc.splitTextToSize(report.aiAnalysis || 'No summary available.', 182);
        doc.text(splitText, 14, currentY);
        currentY += (splitText.length * 7.5) + 12;

        // Labour Table
        if (report.labourEntries && report.labourEntries.length > 0) {
          if (currentY > 240) { doc.addPage(); addHeader(doc, doc.getNumberOfPages()); currentY = 45; }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(13);
          doc.text('2. LABOUR ON SITE:', 14, currentY);
          currentY += 8;
          autoTable(doc, {
            startY: currentY,
            head: [['Labour Name', 'Qty', 'Labour Type', 'Job Work / Task']],
            body: report.labourEntries.map(l => [l.name, l.count, l.role, l.jobWork]),
            theme: 'grid',
            headStyles: { fillColor: [241, 245, 249], textColor: [30, 58, 138], fontSize: 10, fontStyle: 'bold' },
            bodyStyles: { fontSize: 10, textColor: [50, 50, 50] },
            margin: { left: 14, right: 14 },
            styles: { font: 'helvetica', cellPadding: 4 }
          });
          currentY = (doc as any).lastAutoTable.finalY + 14;
        }

        // Safety Checks
        if (report.safetyChecks && report.safetyChecks.length > 0) {
          if (currentY > 250) { doc.addPage(); addHeader(doc, doc.getNumberOfPages()); currentY = 45; }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(13);
          doc.text('3. SAFETY COMPLIANCES:', 14, currentY);
          currentY += 10;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.setLineHeightFactor(1.5);
          report.safetyChecks.forEach((s, sIdx) => {
            doc.text(`${sIdx + 1}. ${s}`, 18, currentY);
            currentY += 8.5;
          });
          currentY += 10;
        }

        // Way Forward / Remarks
        if (report.nextStages && !(report.engineerRole === 'engineer' || report.engineerRole === 'site_supervisor')) {
          if (currentY > 250) { doc.addPage(); addHeader(doc, doc.getNumberOfPages()); currentY = 45; }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(13);
          doc.text('4. WAY FORWARD / REMARKS:', 14, currentY);
          currentY += 10;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.setLineHeightFactor(1.5);
          const splitNextStages = doc.splitTextToSize(report.nextStages, 182);
          doc.text(splitNextStages, 14, currentY);
          currentY += (splitNextStages.length * 7.5) + 12;
        }

        // Images
        if (report.images && report.images.length > 0) {
          if (currentY > 220) { doc.addPage(); addHeader(doc, doc.getNumberOfPages()); currentY = 45; }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.text('SITE PHOTOGRAPHS:', 14, currentY);
          currentY += 7;

          const imgWidth = 42;
          const imgHeight = 32;
          const spacing = 5;
          
          report.images.slice(0, 4).forEach((img, imgIdx) => {
            try {
              if (img && img.startsWith('data:image')) {
                doc.addImage(img, 'JPEG', 14 + (imgIdx * (imgWidth + spacing)), currentY, imgWidth, imgHeight, undefined, 'FAST');
              }
            } catch (e) {
              console.error('Failed to add image to PDF', e);
            }
          });
          currentY += imgHeight + 15;
        }

        // Separator
        doc.setDrawColor(200, 200, 200);
        doc.line(14, currentY - 5, 196, currentY - 5);
        currentY += 5;
      });

      // Final Footer on all pages
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`REIDIUS INFRA PRIVATE LIMITED - CONFIDENTIAL SITE REPORT`, 14, 285);
        doc.text(`Page ${i} of ${totalPages}`, 196, 285, { align: 'right' });
      }

      const generationTimestamp = format(new Date(), 'HHmm');
      doc.save(`REIDIUS_INFRA_Report_${filterDate}_${generationTimestamp}_${siteLabel.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error('PDF Generation Error:', error);
      alert('Failed to generate PDF. Please ensure your browser allows downloads and try again.');
    }
  };

  return (
    <div className="space-y-8">
      <Card className="bg-white border border-slate-100 shadow-sm">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-heading font-bold uppercase tracking-tight">Report Center</CardTitle>
              <CardDescription className="font-bold uppercase text-[9px] tracking-[0.2em] text-slate-400">
                Reidius Infra Private Limited • Daily site progress logs
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 items-end">
            <div className="space-y-2">
              <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Select Date</Label>
              <Input 
                type="date" 
                value={filterDate} 
                onChange={e => setFilterDate(e.target.value)} 
                className="w-full border-slate-200 h-12 font-medium focus:border-yellow-400 transition-all"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Filter by Site</Label>
              <Select value={filterSite} onValueChange={setFilterSite}>
                <SelectTrigger className="h-12 border-slate-200 font-medium">
                  <SelectValue placeholder="All Sites" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sites</SelectItem>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(profile?.role === 'admin' || profile?.role === 'sales') && (
              <div className="space-y-2">
                <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Filter by Staff</Label>
                <Select value={filterStaff} onValueChange={setFilterStaff}>
                  <SelectTrigger className="h-12 border-slate-200 font-medium">
                    <SelectValue placeholder="All Staff" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Staff</SelectItem>
                    {staffMembers.map(staff => (
                      <SelectItem key={staff.id} value={staff.id}>{staff.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={downloadPDF} disabled={filteredReports.length === 0} className="w-full h-12 bg-yellow-400 text-black hover:bg-yellow-500 font-bold uppercase tracking-widest shadow-sm px-8">
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-black hover:bg-black border-none">
                <TableHead className="text-yellow-400 font-bold uppercase text-[10px] tracking-widest h-14">Staff Member</TableHead>
                <TableHead className="text-yellow-400 font-bold uppercase text-[10px] tracking-widest h-14">Site</TableHead>
                <TableHead className="text-yellow-400 font-bold uppercase text-[10px] tracking-widest h-14">Time</TableHead>
                <TableHead className="text-yellow-400 font-bold uppercase text-[10px] tracking-widest h-14">AI Analysis</TableHead>
                {isAdmin && <TableHead className="text-yellow-400 font-bold uppercase text-[10px] tracking-widest h-14 text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 5 : 4} className="text-center py-16 text-slate-300 font-bold uppercase tracking-[0.2em] text-[10px]">
                    No reports for this date
                  </TableCell>
                </TableRow>
              ) : (
                filteredReports.map((r) => (
                  <TableRow key={r.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <TableCell className="py-4">
                      <p className="font-bold uppercase text-[10px] tracking-tight">{r.engineerName}</p>
                      {r.engineerRole && <p className="text-[8px] text-yellow-600 font-bold uppercase tracking-widest">{r.engineerRole}</p>}
                    </TableCell>
                    <TableCell className="py-4">
                      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tight">{r.clientName}</p>
                    </TableCell>
                    <TableCell className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em] py-4">
                      {safeFormat(r.timestamp, 'hh:mm a')}
                    </TableCell>
                    <TableCell className="py-4">
                      <p className="text-[9px] text-slate-500 line-clamp-2 max-w-[300px]">
                        {r.purposeOfVisit ? `PURPOSE: ${r.purposeOfVisit}` : r.aiAnalysis}
                      </p>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => {
                            onDelete(
                              'Delete Report',
                              'Are you sure you want to delete this site progress report? This action cannot be undone.',
                              async () => {
                                try {
                                  await deleteDoc(doc(db, 'site_reports', r.id));
                                } catch (err) {
                                  handleFirestoreError(err, OperationType.DELETE, 'site_reports');
                                }
                              }
                            );
                          }}
                          className="h-8 w-8 text-slate-300 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile View for Reports */}
        <div className="sm:hidden divide-y divide-slate-50">
          {filteredReports.length === 0 ? (
            <div className="py-16 text-center text-slate-300 font-bold uppercase tracking-[0.2em] text-[10px]">
              No reports for this date
            </div>
          ) : (
            filteredReports.map((r) => (
              <div key={r.id} className="p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold uppercase text-[10px] tracking-tight">{r.engineerName}</p>
                    {r.engineerRole && <p className="text-[8px] text-yellow-600 font-bold uppercase tracking-widest">{r.engineerRole}</p>}
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tight">{r.clientName}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em] mt-1">
                      {safeFormat(r.dateStr ? safeParseISO(r.dateStr) : r.timestamp, 'PPP')} • {safeFormat(r.timestamp, 'hh:mm a')}
                    </p>
                    {r.purposeOfVisit && (
                      <p className="text-[9px] text-yellow-600 font-bold uppercase tracking-tight mt-2">
                        Purpose: {r.purposeOfVisit}
                      </p>
                    )}
                  </div>
                  {isAdmin && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => {
                        onDelete(
                          'Delete Report',
                          'Are you sure you want to delete this site progress report? This action cannot be undone.',
                          async () => {
                            try {
                              await deleteDoc(doc(db, 'site_reports', r.id));
                            } catch (err) {
                              handleFirestoreError(err, OperationType.DELETE, 'site_reports');
                            }
                          }
                        );
                      }}
                      className="h-8 w-8 text-slate-300 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-slate-600 line-clamp-3 leading-relaxed bg-slate-50 p-2 rounded-lg border border-slate-100">
                  {r.aiAnalysis}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// --- Design Requirement Dialog ---
function DesignRequirementDialog({ 
  profile, 
  clients 
}: { 
  profile: UserProfile | null, 
  clients: Client[] 
}) {
  const [open, setOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [requirement, setRequirement] = useState('');
  const [priority, setPriority] = useState<'Low' | 'Medium' | 'High' | 'Urgent'>('Medium');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!profile) return;
    if (!selectedClientId) {
      alert('Please select a site/client.');
      return;
    }
    if (!requirement.trim()) {
      alert('Please enter your design requirement.');
      return;
    }

    setSubmitting(true);
    try {
      const selectedClient = clients.find(c => c.id === selectedClientId);
      await addDoc(collection(db, 'design_requirements'), {
        engineerId: profile.uid,
        engineerName: profile.name,
        engineerRole: profile.role,
        clientId: selectedClientId,
        clientName: selectedClient?.name || 'Unknown',
        requirement,
        priority,
        status: 'Pending',
        timestamp: serverTimestamp()
      });
      setOpen(false);
      setRequirement('');
      setSelectedClientId('');
      setPriority('Medium');
      alert('Design requirement raised successfully.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'design_requirements');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button className="bg-yellow-400 text-black hover:bg-yellow-500 font-bold uppercase text-[10px] tracking-widest px-6">
          <Plus className="h-3.5 w-3.5 mr-2" />
          Raise Requirement
        </Button>
      } />
      <DialogContent className="fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] w-[95%] max-w-[450px] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden p-0 focus:outline-none">
        <DialogHeader className="p-5 bg-slate-900 text-white">
          <DialogTitle className="text-lg font-heading font-bold uppercase tracking-tight">New Design Requirement</DialogTitle>
        </DialogHeader>
        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto no-scrollbar">
          <div className="space-y-2">
            <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Select Site / Client</Label>
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger className="h-11 border-slate-100 font-medium text-sm rounded-xl">
                <SelectValue placeholder="Select a site" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id} className="text-sm">
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Requirement Details</Label>
            <Textarea 
              placeholder="Describe the design requirement in detail..."
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              className="min-h-[120px] text-sm bg-slate-50 border-slate-100 focus:bg-white transition-all rounded-xl p-4"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold uppercase tracking-[0.2em] text-[10px] text-slate-500">Priority Level</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['Low', 'Medium', 'High', 'Urgent'] as const).map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant={priority === p ? 'default' : 'outline'}
                  onClick={() => setPriority(p)}
                  className={cn(
                    "text-[9px] font-bold uppercase tracking-widest h-10 rounded-xl",
                    priority === p && p === 'Urgent' ? 'bg-red-600 hover:bg-red-700' :
                    priority === p && p === 'High' ? 'bg-orange-500 hover:bg-orange-600' :
                    priority === p && p === 'Medium' ? 'bg-yellow-400 text-black hover:bg-yellow-500' :
                    priority === p && p === 'Low' ? 'bg-slate-900 hover:bg-slate-800' : ""
                  )}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="p-5 bg-slate-50 border-t border-slate-100">
          <Button onClick={handleSubmit} disabled={submitting} className="w-full h-12 text-[11px] font-bold uppercase tracking-widest bg-yellow-400 text-black hover:bg-yellow-500 shadow-sm rounded-xl">
            {submitting ? 'Raising Requirement...' : 'Submit to Architect'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Design Requirements View ---
function DesignRequirementsView({ 
  designRequirements, 
  profile, 
  clients 
}: { 
  designRequirements: DesignRequirement[],
  profile: UserProfile | null,
  clients: Client[]
}) {
  const isArchitectOrAdmin = profile?.role === 'architect' || profile?.role === 'admin' || profile?.email === 'vinita@reidiusinfra.com' || profile?.email === 'vinitaagrawalec@gmail.com';
  const isArchitect = profile?.role === 'architect';

  const downloadExcel = () => {
    try {
      const data = designRequirements.map(req => ({
        'Client Name': req.clientName,
        'Requirement': req.requirement,
        'Priority': req.priority,
        'Status': req.status,
        'Raised By': req.engineerName,
        'Engineer Role': req.engineerRole?.replace('_', ' ') || 'Engineer',
        'Timestamp': safeFormat(req.timestamp, 'p, PPP')
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Design Requirements');
      
      // Auto-size columns
      const colWidths = [
        { wch: 20 }, // Client Name
        { wch: 50 }, // Requirement
        { wch: 10 }, // Priority
        { wch: 15 }, // Status
        { wch: 20 }, // Raised By
        { wch: 15 }, // Role
        { wch: 25 }, // Timestamp
      ];
      ws['!cols'] = colWidths;

      XLSX.writeFile(wb, `Design_Requirements_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    } catch (err) {
      console.error('Excel Export failed:', err);
      alert('Failed to export Excel file.');
    }
  };

  const updateStatus = async (id: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'design_requirements', id), {
        status: newStatus
      });
      alert(`Requirement status updated to ${newStatus}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'design_requirements');
    }
  };

  const deleteRequirement = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this design requirement?')) return;
    try {
      await deleteDoc(doc(db, 'design_requirements', id));
      alert('Requirement deleted successfully.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'design_requirements');
    }
  };

  const getPriorityColor = (priority: string) => {
    switch(priority) {
      case 'Urgent': return 'bg-red-600 text-white';
      case 'High': return 'bg-orange-500 text-white';
      case 'Medium': return 'bg-yellow-400 text-black';
      case 'Low': return 'bg-slate-200 text-slate-700';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'Resolved': return 'bg-green-100 text-green-700';
      case 'In Progress': return 'bg-blue-100 text-blue-700';
      case 'Pending': return 'bg-slate-100 text-slate-600';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-heading font-bold uppercase tracking-tight">Design Requirements</h2>
          <p className="text-[10px] sm:text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">From Site to Architecture Team</p>
        </div>
        <div className="flex items-center gap-2">
          {isArchitectOrAdmin && (
            <Button 
              onClick={downloadExcel}
              className="bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 font-bold uppercase text-[10px] tracking-widest px-4 h-10 rounded-xl flex items-center gap-2 shadow-sm"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export Excel</span>
              <span className="sm:hidden">Export</span>
            </Button>
          )}
          {!isArchitect && <DesignRequirementDialog profile={profile} clients={clients} />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        {designRequirements.length === 0 ? (
          <div className="py-20 text-center text-slate-300 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
            <DraftingCompass className="h-12 w-12 mx-auto mb-4 opacity-10" />
            <p className="font-bold uppercase tracking-[0.2em] text-[10px]">No design requirements raised yet</p>
          </div>
        ) : (
          designRequirements.map((req) => (
            <Card key={req.id} className="border border-slate-100 shadow-sm overflow-hidden bg-white">
              <CardContent className="p-0">
                <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start sm:items-center gap-3 sm:gap-4">
                    <Badge className={cn("font-bold uppercase tracking-widest text-[7px] sm:text-[8px] px-1.5 py-0.5 mt-0.5 sm:mt-0", getPriorityColor(req.priority))}>
                      {req.priority}
                    </Badge>
                    <div>
                      <h3 className="font-bold text-sm uppercase tracking-tight leading-none mb-1">{req.clientName}</h3>
                      <p className="text-[9px] sm:text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        By {req.engineerName} {req.engineerRole && `(${req.engineerRole.replace('_', ' ')})`} • {safeFormat(req.timestamp, 'p, PPP')}
                      </p>
                    </div>
                  </div>
                  <Badge className={cn("self-start sm:self-center font-bold uppercase tracking-widest text-[8px] sm:text-[9px] px-2.5 py-1 border-none", getStatusColor(req.status))}>
                    {req.status}
                  </Badge>
                </div>
                
                <div className="p-4 sm:p-6">
                  <div className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-wrap mb-4 sm:mb-6 bg-slate-50/30 p-3 sm:p-4 rounded-xl border border-slate-100/50 italic">
                    "{req.requirement}"
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 sm:pt-4 border-t border-slate-50">
                    <div className="flex flex-wrap items-center gap-2">
                      {isArchitectOrAdmin && (
                        <>
                          <Button 
                            variant="outline" 
                            size="sm"
                            disabled={req.status === 'In Progress'}
                            onClick={() => updateStatus(req.id, 'In Progress')}
                            className="text-[8px] sm:text-[9px] font-bold uppercase tracking-widest h-7 sm:h-8 px-2 sm:px-3"
                          >
                            In Progress
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            disabled={req.status === 'Resolved'}
                            onClick={() => updateStatus(req.id, 'Resolved')}
                            className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100 text-[8px] sm:text-[9px] font-bold uppercase tracking-widest h-7 sm:h-8 px-2 sm:px-3"
                          >
                            Resolved
                          </Button>
                        </>
                      )}
                    </div>
                    {isArchitectOrAdmin && (
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => deleteRequirement(req.id)}
                        className="h-8 w-8 text-slate-300 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
