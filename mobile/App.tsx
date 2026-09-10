import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  FlatList,
  Image,
  ActivityIndicator,
  Modal,
  Platform,
  RefreshControl,
  KeyboardAvoidingView,
} from "react-native";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  User,
} from "firebase/auth";

import {
  addDoc,
  collection,
  serverTimestamp,
  getDocs,
  query,
  where,
  orderBy,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  Timestamp,
  getDoc,
} from "firebase/firestore";

import { auth, db, storage } from "./firebaseConfig";
import * as ImagePicker from "expo-image-picker";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import DateTimePicker from "@react-native-community/datetimepicker";

type Item = {
  id: string;
  type: "LOST" | "FOUND";
  title: string;
  description: string;
  category: string;
  location: string;
  dateLost?: string;
  dateFound?: string;
  status: string;
  userId: string;
  userEmail: string;
  imageUrl?: string;
  hidden?: boolean;
};

type Message = { id: string; senderId: string; receiverId: string; text: string; createdAt?: any };
type Conversation = { id: string; itemId: string; itemTitle: string; participants: string[]; lastMessage?: string; lastMessageTime?: any; otherUserEmail?: string; otherUserId?: string };
type Notification = { id: string; userId: string; title: string; message: string; type: "MATCH" | "MESSAGE" | "STATUS"; read: boolean; itemId?: string; conversationId?: string; createdAt?: any };

const CATEGORIES = ["Electronics", "Clothing", "Books", "Bags & Backpacks", "Keys", "Wallet & Cards", "Jewelry", "Sports Equipment", "Water Bottles", "Headphones", "Glasses", "Umbrella", "Other"];
const CAMPUS_EMAIL_DOMAIN = "smsu.edu";
const ADMIN_EMAILS = ["lostandfound@smsu.edu"];
const isCampusEmail = (value: string) => value.trim().toLowerCase().endsWith(`@${CAMPUS_EMAIL_DOMAIN}`);
const isAllowedEmail = (value: string) => {
  const email = value.trim().toLowerCase();
  return isCampusEmail(email) || email.endsWith("@gmail.com");
};
const isAdminEmail = (value?: string | null) => !!value && ADMIN_EMAILS.includes(value.trim().toLowerCase());
const PRIVACY_TEXT = "Campus Lost & Found is for SMSU students and staff. Reports, photos, and your campus email are visible to signed-in campus users so items can be identified and returned. Private chats are only visible to the two people in the conversation. Do not post IDs, passwords, or sensitive personal data in photos or descriptions. Moderators may hide or remove posts that are inappropriate or not related to lost-and-found. This is a student project and is not an official SMSU record. Contact lostandfound@smsu.edu with concerns.";

const formatMessageTime = (timestamp: any) => {
  if (!timestamp) return "";
  let date: Date;
  if (timestamp instanceof Timestamp) date = timestamp.toDate();
  else if (timestamp.seconds) date = new Date(timestamp.seconds * 1000);
  else date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  else if (days === 1) return "Yesterday";
  else if (days < 7) return date.toLocaleDateString([], { weekday: "short" });
  else return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const formatDate = (date: Date) => {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month.toString().padStart(2, "0")}/${day.toString().padStart(2, "0")}/${year}`;
};

const getMatchScore = (lostItem: Item, foundItem: Item) => {
  let score = 0;
  const category1 = (lostItem.category || "").trim().toLowerCase();
  const category2 = (foundItem.category || "").trim().toLowerCase();
  if (category1 && category2 && category1 === category2) score += 40;
  const location1 = (lostItem.location || "").trim().toLowerCase();
  const location2 = (foundItem.location || "").trim().toLowerCase();
  if (location1 && location2) {
    if (location1 === location2) score += 25;
    else if (location1.includes(location2) || location2.includes(location1)) score += 15;
    else {
      const words1 = location1.split(/\s+/);
      const words2 = location2.split(/\s+/);
      if (words1.some((word) => word.length > 2 && words2.includes(word))) score += 10;
    }
  }
  const stopWords = new Set(["the", "a", "an", "and", "with", "my", "is", "this", "item", "found", "lost", "near", "has", "was", "to", "of", "in", "at", "on", "for", "small"]);
  const makeWords = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 2 && !stopWords.has(word));
  const lostWords = makeWords(`${lostItem.title || ""} ${lostItem.description || ""}`);
  const foundWords = makeWords(`${foundItem.title || ""} ${foundItem.description || ""}`);
  const commonWords = [...new Set(lostWords)].filter((word) => foundWords.includes(word));
  if (commonWords.length >= 3) score += 20;
  else if (commonWords.length === 2) score += 15;
  else if (commonWords.length === 1) score += 8;
  const parseDate = (value?: string) => {
    if (!value) return NaN;
    const parts = value.split("/");
    if (parts.length === 3) {
      const month = Number(parts[0]);
      const day = Number(parts[1]);
      const year = Number(parts[2]);
      if (month && day && year) return new Date(year, month - 1, day).getTime();
    }
    return new Date(value).getTime();
  };
  const lostDate = parseDate(lostItem.dateLost);
  const foundDate = parseDate(foundItem.dateFound);
  if (!Number.isNaN(lostDate) && !Number.isNaN(foundDate)) {
    const daysApart = Math.abs(lostDate - foundDate) / (1000 * 60 * 60 * 24);
    if (daysApart <= 1) score += 15;
    else if (daysApart <= 3) score += 10;
    else if (daysApart <= 7) score += 5;
  }
  return Math.min(score, 100);
};

const getMatchBreakdown = (lostItem: Item, foundItem: Item) => {
  const category1 = (lostItem.category || "").trim().toLowerCase();
  const category2 = (foundItem.category || "").trim().toLowerCase();
  const location1 = (lostItem.location || "").trim().toLowerCase();
  const location2 = (foundItem.location || "").trim().toLowerCase();
  const stopWords = new Set(["the", "a", "an", "and", "with", "my", "is", "this", "item", "found", "lost", "near", "has", "was", "to", "of", "in", "at", "on", "for", "small"]);
  const makeWords = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 2 && !stopWords.has(word));
  const lostWords = makeWords(`${lostItem.title || ""} ${lostItem.description || ""}`);
  const foundWords = makeWords(`${foundItem.title || ""} ${foundItem.description || ""}`);
  const commonWords = [...new Set(lostWords)].filter((word) => foundWords.includes(word));
  const parseDate = (value?: string) => {
    if (!value) return NaN;
    const parts = value.split("/");
    if (parts.length === 3) {
      const month = Number(parts[0]);
      const day = Number(parts[1]);
      const year = Number(parts[2]);
      if (month && day && year) return new Date(year, month - 1, day).getTime();
    }
    return new Date(value).getTime();
  };
  const lostDate = parseDate(lostItem.dateLost);
  const foundDate = parseDate(foundItem.dateFound);
  const daysApart = !Number.isNaN(lostDate) && !Number.isNaN(foundDate) ? Math.abs(lostDate - foundDate) / (1000 * 60 * 60 * 24) : Infinity;
  return {
    category: category1 && category1 === category2,
    location: location1 === location2 || (location1 && location2 && (location1.includes(location2) || location2.includes(location1))),
    keywords: commonWords.length > 0,
    date: daysApart <= 7,
  };
};

const getMatchLabel = (score: number) => {
  if (score >= 75) return "Strong Possible Match";
  if (score >= 50) return "Possible Match";
  return "Low Match";
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [screen, setScreen] = useState("home");
  const [loading, setLoading] = useState(false);
  const [lostTitle, setLostTitle] = useState("");
  const [lostDescription, setLostDescription] = useState("");
  const [lostCategory, setLostCategory] = useState("");
  const [lostLocation, setLostLocation] = useState("");
  const [dateLost, setDateLost] = useState("");
  const [lostImage, setLostImage] = useState<string | null>(null);
  const [showLostDatePicker, setShowLostDatePicker] = useState(false);
  const [lostDateObj, setLostDateObj] = useState(new Date());
  const [showLostCategoryModal, setShowLostCategoryModal] = useState(false);
  const [foundTitle, setFoundTitle] = useState("");
  const [foundDescription, setFoundDescription] = useState("");
  const [foundCategory, setFoundCategory] = useState("");
  const [foundLocation, setFoundLocation] = useState("");
  const [dateFound, setDateFound] = useState("");
  const [foundImage, setFoundImage] = useState<string | null>(null);
  const [showFoundDatePicker, setShowFoundDatePicker] = useState(false);
  const [foundDateObj, setFoundDateObj] = useState(new Date());
  const [showFoundCategoryModal, setShowFoundCategoryModal] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDateObj, setEditDateObj] = useState(new Date());
  const [showEditDatePicker, setShowEditDatePicker] = useState(false);
  const [showEditCategoryModal, setShowEditCategoryModal] = useState(false);
  const [editImage, setEditImage] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatOtherUserId, setChatOtherUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [matchResults, setMatchResults] = useState<{ lostItem: Item; foundItem: Item; score: number }[]>([]);
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "LOST" | "FOUND">("ALL");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "az" | "za">("newest");
  const [detailsBackScreen, setDetailsBackScreen] = useState("browse");
  const messageListRef = useRef<FlatList<Message>>(null);

  const onRefreshBrowse = async () => { setRefreshing(true); await loadItems(); setRefreshing(false); };
  const onRefreshConversations = async () => { setRefreshing(true); await loadConversations(); setRefreshing(false); };
  const onRefreshProfile = async () => { setRefreshing(true); await loadItems(); setRefreshing(false); };
  const onRefreshNotifications = async () => { setRefreshing(true); await loadNotifications(); await loadItems(); setRefreshing(false); };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser && !isAllowedEmail(currentUser.email || "")) {
        Alert.alert("Email not allowed", "Use your @smsu.edu email, or Gmail while testing.");
        signOut(auth);
        setUser(null);
        return;
      }
      setUser(currentUser);
      if (currentUser) setScreen("home");
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!user) return;
    loadItems();
    const notifQuery = query(collection(db, "notifications"), where("userId", "==", user.uid), orderBy("createdAt", "desc"));
    const unsubNotifs = onSnapshot(notifQuery, (snapshot) => {
      const loadedNotifs: Notification[] = [];
      let unread = 0;
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        loadedNotifs.push({ id: docSnap.id, userId: data.userId, title: data.title, message: data.message, type: data.type, read: data.read || false, itemId: data.itemId, conversationId: data.conversationId, createdAt: data.createdAt });
        if (!data.read) unread++;
      });
      setNotifications(loadedNotifs);
      setUnreadCount(unread);
    }, (error) => { console.log("Error loading notifications:", error.message); });
    const convoQuery = query(collection(db, "conversations"), where("participants", "array-contains", user.uid), orderBy("updatedAt", "desc"));
    const unsubConvos = onSnapshot(convoQuery, (snapshot) => {
      const loadedConvos: Conversation[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const participants: string[] = data.participants || [];
        const otherUserId = participants.find((id) => id !== user.uid) || "";
        const emails = data.participantEmails || {};
        loadedConvos.push({
          id: docSnap.id,
          itemId: data.itemId,
          itemTitle: data.itemTitle,
          participants,
          lastMessage: data.lastMessage || "",
          lastMessageTime: data.updatedAt,
          otherUserId,
          otherUserEmail: emails[otherUserId] || data.otherUserEmail || "User",
        });
      });
      setConversations(loadedConvos);
    }, (error) => { console.log("Error loading conversations:", error.message); });
    return () => { unsubNotifs(); unsubConvos(); };
  }, [user]);
  useEffect(() => { if (!conversationId) return; const messagesRef = collection(db, "conversations", conversationId, "messages"); const messagesQuery = query(messagesRef, orderBy("createdAt", "asc")); const unsubscribe = onSnapshot(messagesQuery, (snapshot) => { const loadedMessages: Message[] = []; snapshot.forEach((d) => { loadedMessages.push({ id: d.id, ...(d.data() as Omit<Message, "id">) }); }); setMessages(loadedMessages); }); return () => unsubscribe(); }, [conversationId]);

  const loadNotifications = async () => {
    if (!user) return;
    try {
      const notifRef = collection(db, "notifications");
      const notifQuery = query(notifRef, where("userId", "==", user.uid), orderBy("createdAt", "desc"));
      const snapshot = await getDocs(notifQuery);
      const loadedNotifs: Notification[] = [];
      let unread = 0;
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        loadedNotifs.push({ id: docSnap.id, userId: data.userId, title: data.title, message: data.message, type: data.type, read: data.read || false, itemId: data.itemId, conversationId: data.conversationId, createdAt: data.createdAt });
        if (!data.read) unread++;
      });
      setNotifications(loadedNotifs);
      setUnreadCount(unread);
    } catch (error: any) { console.log("Error loading notifications:", error.message); }
  };

  const loadConversations = async () => {
    if (!user) return;
    try {
      const convoRef = collection(db, "conversations");
      const convoQuery = query(convoRef, where("participants", "array-contains", user.uid), orderBy("updatedAt", "desc"));
      const snapshot = await getDocs(convoQuery);
      const loadedConvos: Conversation[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const participants: string[] = data.participants || [];
        const otherUserId = participants.find((id) => id !== user.uid) || "";
        const emails = data.participantEmails || {};
        loadedConvos.push({
          id: docSnap.id,
          itemId: data.itemId,
          itemTitle: data.itemTitle,
          participants,
          lastMessage: data.lastMessage || "",
          lastMessageTime: data.updatedAt,
          otherUserId,
          otherUserEmail: emails[otherUserId] || data.otherUserEmail || "User",
        });
      });
      setConversations(loadedConvos);
    } catch (error: any) { console.log("Error loading conversations:", error.message); }
  };

  const loadItems = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "items"));
      const loadedItems: Item[] = [];
      querySnapshot.forEach((d) => { loadedItems.push({ id: d.id, ...(d.data() as Omit<Item, "id">) }); });
      setItems(loadedItems);
    } catch (error: any) { console.log("Error loading items:", error.message); }
  };

  const markNotificationRead = async (notifId: string) => {
    try {
      await updateDoc(doc(db, "notifications", notifId), { read: true });
      setNotifications((prev) => prev.map((n) => (n.id === notifId ? { ...n, read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error: any) { console.log("Error marking notification read:", error.message); }
  };

  const markAllNotificationsRead = async () => {
    try {
      const unreadNotifs = notifications.filter((n) => !n.read);
      for (const notif of unreadNotifs) { await updateDoc(doc(db, "notifications", notif.id), { read: true }); }
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error: any) { Alert.alert("Error", error.message); }
  };

  const createNotification = async (targetUserId: string, title: string, message: string, type: "MATCH" | "MESSAGE" | "STATUS", itemId?: string, conversationId?: string) => {
    try { await addDoc(collection(db, "notifications"), { userId: targetUserId, title, message, type, read: false, itemId, conversationId: conversationId || null, createdAt: serverTimestamp() }); }
    catch (error: any) { console.log("Error creating notification:", error.message); }
  };

  const notifyMatchesForNewItem = async (newItem: Item) => {
    const isLost = newItem.type === "LOST";
    const candidates = items.filter((item) => {
      if (!item.userId || item.userId === newItem.userId || item.hidden) return false;
      if (isLost) return (item.type || "").toUpperCase() === "FOUND" && (item.status || "").toUpperCase() === "FOUND";
      return (item.type || "").toUpperCase() === "LOST" && (item.status || "").toUpperCase() === "LOST";
    });
    for (const other of candidates) {
      const lostItem = isLost ? newItem : other;
      const foundItem = isLost ? other : newItem;
      const score = getMatchScore(lostItem, foundItem);
      if (score < 40) continue;
      await createNotification(
        other.userId,
        "Possible Match",
        `A new ${isLost ? "lost" : "found"} item may match "${other.title}" (${score}%)`,
        "MATCH",
        newItem.id
      );
    }
  };

  const notifyItemRecovered = async (item: Item) => {
    if (!user) return;
    try {
      const snapshot = await getDocs(query(collection(db, "conversations"), where("itemId", "==", item.id), where("participants", "array-contains", user.uid)));
      const notified = new Set<string>();
      snapshot.forEach((docSnap) => {
        const participants: string[] = docSnap.data().participants || [];
        participants.forEach((id) => {
          if (id && id !== user.uid) notified.add(id);
        });
      });
      for (const targetId of notified) {
        await createNotification(targetId, "Item Recovered", `"${item.title}" was marked as recovered.`, "STATUS", item.id);
      }
    } catch (error: any) {
      console.log("Error notifying recovered status:", error.message);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) { Alert.alert("Enter Email", "Please enter your email address first."); return; }
    if (!isAllowedEmail(email)) { Alert.alert("Email not allowed", "Use your @smsu.edu email, or Gmail while testing."); return; }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      Alert.alert("Email Sent! 📧", "Check your inbox for a password reset link.", [{ text: "OK" }]);
    } catch (error: any) { Alert.alert("Error", error.message); }
    setLoading(false);
  };

  const handleAuth = async () => {
    if (!email || !password) { Alert.alert("Error", "Please enter email and password."); return; }
    if (!isAllowedEmail(email)) { Alert.alert("Email not allowed", "Use your @smsu.edu email, or Gmail while testing."); return; }
    if (isRegister && !privacyAgreed) { Alert.alert("Privacy Notice", "Please read and agree to the privacy note before creating an account."); return; }
    setLoading(true);
    try {
      if (isRegister) { await createUserWithEmailAndPassword(auth, email, password); Alert.alert("Success", "Your account has been created!"); }
      else { await signInWithEmailAndPassword(auth, email, password); }
      setEmail(""); setPassword(""); setPrivacyAgreed(false);
    } catch (error: any) { Alert.alert("Authentication Error", error.message); }
    setLoading(false);
  };

  const handleLogout = async () => {
    try { await signOut(auth); setScreen("home"); setNotifications([]); setUnreadCount(0); setConversations([]); setItems([]); setConversationId(null); setChatOtherUserId(null); setMessages([]); setEditImage(null); }
    catch (error: any) { Alert.alert("Error", error.message); }
  };

  const pickImage = async (type: "lost" | "found" | "edit") => {
    Alert.alert("Add Photo 📷", "How would you like to add a photo?", [
      {
        text: "Take Photo with Camera",
        onPress: async () => {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) { Alert.alert("Permission needed", "Please allow camera access in settings."); return; }
          const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [4, 3], quality: 0.8 });
          if (!result.canceled && result.assets[0]?.uri) {
            if (type === "lost") setLostImage(result.assets[0].uri);
            else if (type === "found") setFoundImage(result.assets[0].uri);
            else setEditImage(result.assets[0].uri);
          }
        },
      },
      {
        text: "Choose from Gallery",
        onPress: async () => {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) { Alert.alert("Permission needed", "Please allow photo library access in settings."); return; }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [4, 3], quality: 0.8 });
          if (!result.canceled && result.assets[0]?.uri) {
            if (type === "lost") setLostImage(result.assets[0].uri);
            else if (type === "found") setFoundImage(result.assets[0].uri);
            else setEditImage(result.assets[0].uri);
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const uploadImage = async (uri: string, oduserId: string) => {
    if (!storage) { throw new Error("Firebase Storage is not initialized."); }
    const response = await fetch(uri);
    if (!response.ok) { throw new Error("Could not read the selected image."); }
    const blob = await response.blob();
    if (!blob) { throw new Error("The selected image could not be prepared for upload."); }
    const filePath = `item-images/${oduserId}/${Date.now()}.jpg`;
    const fileRef = ref(storage, filePath);
    await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
    const downloadUrl = await getDownloadURL(fileRef);
    return downloadUrl;
  };

  const handleSubmitLostItem = async () => {
    if (!lostTitle || !lostDescription || !lostCategory || !lostLocation || !dateLost) { Alert.alert("Missing Information", "Please fill in all fields."); return; }
    if (!user) return;
    setLoading(true);
    try {
      const imageUrl = lostImage ? await uploadImage(lostImage, user.uid) : "";
      const docRef = await addDoc(collection(db, "items"), { type: "LOST", title: lostTitle, description: lostDescription, category: lostCategory, location: lostLocation, dateLost: dateLost, status: "LOST", userId: user.uid, userEmail: user.email, imageUrl, createdAt: serverTimestamp() });
      await notifyMatchesForNewItem({ id: docRef.id, type: "LOST", title: lostTitle, description: lostDescription, category: lostCategory, location: lostLocation, dateLost, status: "LOST", userId: user.uid, userEmail: user.email || "", imageUrl });
      Alert.alert("Success", "Lost item reported successfully!");
      setLostTitle(""); setLostDescription(""); setLostCategory(""); setLostLocation(""); setDateLost(""); setLostImage(null);
      await loadItems(); setScreen("home");
    } catch (error: any) { Alert.alert("Upload Error", error?.message || "Could not submit the lost item."); }
    setLoading(false);
  };

  const handleSubmitFoundItem = async () => {
    if (!foundTitle || !foundDescription || !foundCategory || !foundLocation || !dateFound) { Alert.alert("Missing Information", "Please fill in all fields."); return; }
    if (!user) return;
    setLoading(true);
    try {
      const imageUrl = foundImage ? await uploadImage(foundImage, user.uid) : "";
      const docRef = await addDoc(collection(db, "items"), { type: "FOUND", title: foundTitle, description: foundDescription, category: foundCategory, location: foundLocation, dateFound: dateFound, status: "FOUND", userId: user.uid, userEmail: user.email, imageUrl, createdAt: serverTimestamp() });
      await notifyMatchesForNewItem({ id: docRef.id, type: "FOUND", title: foundTitle, description: foundDescription, category: foundCategory, location: foundLocation, dateFound, status: "FOUND", userId: user.uid, userEmail: user.email || "", imageUrl });
      Alert.alert("Success", "Found item reported successfully!");
      setFoundTitle(""); setFoundDescription(""); setFoundCategory(""); setFoundLocation(""); setDateFound(""); setFoundImage(null);
      await loadItems(); setScreen("home");
    } catch (error: any) { Alert.alert("Upload Error", error?.message || "Could not submit the found item."); }
    setLoading(false);
  };

  const handleDeleteItem = async (item: Item) => {
    const admin = isAdminEmail(user?.email);
    if (!user || (item.userId !== user.uid && !admin)) { Alert.alert("Error", "You can only delete your own items."); return; }
    Alert.alert("Delete Item?", `Are you sure you want to delete "${item.title}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        setLoading(true);
        try { await deleteDoc(doc(db, "items", item.id)); setItems((current) => current.filter((i) => i.id !== item.id)); Alert.alert("Deleted", "Item has been deleted."); setScreen(admin && item.userId !== user.uid ? "moderate" : "profile"); }
        catch (error: any) { Alert.alert("Error", error.message); }
        setLoading(false);
      }}
    ]);
  };

  const toggleHiddenItem = async (item: Item) => {
    if (!isAdminEmail(user?.email)) { Alert.alert("Error", "Only moderators can hide posts."); return; }
    const hidden = !item.hidden;
    try {
      await updateDoc(doc(db, "items", item.id), { hidden });
      const updated = { ...item, hidden };
      setSelectedItem(updated);
      setItems((current) => current.map((x) => (x.id === item.id ? updated : x)));
      Alert.alert("Updated", hidden ? "This post is now hidden from browse and matching." : "This post is visible again.");
    } catch (error: any) { Alert.alert("Error", error.message); }
  };

  const openEditScreen = (item: Item) => {
    setEditTitle(item.title); setEditDescription(item.description); setEditCategory(item.category); setEditLocation(item.location);     setEditDate(item.dateLost || item.dateFound || "");
    setEditImage(item.imageUrl || null);
    const dateStr = item.dateLost || item.dateFound || "";
    if (dateStr) { const parts = dateStr.split("/"); if (parts.length === 3) { const month = parseInt(parts[0]) - 1; const day = parseInt(parts[1]); const year = parseInt(parts[2]); setEditDateObj(new Date(year, month, day)); } }
    setScreen("edit");
  };

  const handleSaveEdit = async () => {
    if (!selectedItem || !user) return;
    if (!editTitle || !editDescription || !editCategory || !editLocation || !editDate) { Alert.alert("Missing Information", "Please fill in all fields."); return; }
    setLoading(true);
    try {
      const updateData: any = { title: editTitle, description: editDescription, category: editCategory, location: editLocation };
      if (selectedItem.type === "LOST") { updateData.dateLost = editDate; } else { updateData.dateFound = editDate; }
      if (editImage && editImage !== selectedItem.imageUrl && !editImage.startsWith("http")) {
        updateData.imageUrl = await uploadImage(editImage, user.uid);
      } else if (editImage) {
        updateData.imageUrl = editImage;
      }
      await updateDoc(doc(db, "items", selectedItem.id), updateData);
      const updatedItem = { ...selectedItem, ...updateData };
      setSelectedItem(updatedItem);
      setItems((current) => current.map((i) => (i.id === selectedItem.id ? updatedItem : i)));
      Alert.alert("Success", "Item updated successfully!");
      setScreen("details");
    } catch (error: any) { Alert.alert("Error", error.message); }
    setLoading(false);
  };

  const markAsRecovered = async (item: Item) => {
    if (!user || item.userId !== user.uid) return;
    Alert.alert("Mark as Recovered?", "This will remove the item from smart matching.", [
      { text: "Cancel", style: "cancel" },
      { text: "Yes, Recovered", onPress: async () => {
        try { await updateDoc(doc(db, "items", item.id), { status: "RECOVERED" }); const updated = { ...item, status: "RECOVERED" }; setSelectedItem(updated); setItems((current) => current.map((x) => (x.id === item.id ? updated : x))); await notifyItemRecovered(item); Alert.alert("Updated", "Your item is now marked as recovered."); }
        catch (error: any) { Alert.alert("Error", error.message); }
      }}
    ]);
  };

  const openBrowseItems = async () => { setLoading(true); await loadItems(); setLoading(false); setScreen("browse"); };

  const filteredItems = items
    .filter((item) => !item.hidden)
    .filter((item) => {
      const search = searchText.toLowerCase();
      const matchesSearch = item.title?.toLowerCase().includes(search) || item.description?.toLowerCase().includes(search) || item.category?.toLowerCase().includes(search) || item.location?.toLowerCase().includes(search);
      const matchesType = typeFilter === "ALL" || item.type === typeFilter;
      const matchesCategory = !categoryFilter || item.category?.toLowerCase().includes(categoryFilter.toLowerCase());
      const matchesLocation = !locationFilter || item.location?.toLowerCase().includes(locationFilter.toLowerCase());
      return matchesSearch && matchesType && matchesCategory && matchesLocation;
    })
    .sort((a, b) => {
      if (sortBy === "newest") { const dateA = a.dateLost || a.dateFound || ""; const dateB = b.dateLost || b.dateFound || ""; return dateB.localeCompare(dateA); }
      if (sortBy === "oldest") { const dateA = a.dateLost || a.dateFound || ""; const dateB = b.dateLost || b.dateFound || ""; return dateA.localeCompare(dateB); }
      if (sortBy === "az") { return (a.title || "").localeCompare(b.title || ""); }
      if (sortBy === "za") { return (b.title || "").localeCompare(a.title || ""); }
      return 0;
    });

  const clearFilters = () => { setSearchText(""); setTypeFilter("ALL"); setCategoryFilter(""); setLocationFilter(""); setSortBy("newest"); };

  const openConversation = async () => {
    if (!user || !selectedItem) return;
    if (selectedItem.userId === user.uid) { Alert.alert("Notice", "You cannot message yourself."); return; }
    setLoading(true);
    try {
      const conversationsRef = collection(db, "conversations");
      const existingQuery = query(conversationsRef, where("itemId", "==", selectedItem.id), where("participants", "array-contains", user.uid));
      const snapshot = await getDocs(existingQuery);
      let existingConversationId: string | null = null;
      snapshot.forEach((d) => { const data = d.data(); if (Array.isArray(data.participants) && data.participants.includes(selectedItem.userId)) { existingConversationId = d.id; } });
      if (!existingConversationId) {
        const newConversation = await addDoc(conversationsRef, {
          itemId: selectedItem.id,
          itemTitle: selectedItem.title,
          participants: [user.uid, selectedItem.userId],
          participantEmails: {
            [user.uid]: user.email || "User",
            [selectedItem.userId]: selectedItem.userEmail || "User",
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        existingConversationId = newConversation.id;
      }
      setConversationId(existingConversationId);
      setChatOtherUserId(selectedItem.userId);
      setScreen("messages");
    } catch (error: any) { Alert.alert("Messaging Error", error.message); }
    setLoading(false);
  };

  const openConversationFromList = async (convo: Conversation) => {
    setLoading(true);
    try {
      const item = items.find((i) => i.id === convo.itemId);
      if (item) { setSelectedItem(item); }
      else { setSelectedItem({ id: convo.itemId, title: convo.itemTitle, type: "LOST", description: "", category: "", location: "", status: "", userId: convo.otherUserId || "", userEmail: convo.otherUserEmail || "" }); }
      setConversationId(convo.id);
      setChatOtherUserId(convo.otherUserId || convo.participants.find((id) => id !== user?.uid) || null);
      setScreen("messages");
    } catch (error: any) { Alert.alert("Error", error.message); }
    setLoading(false);
  };

  const openNotification = async (notif: Notification) => {
    await markNotificationRead(notif.id);
    if (notif.type === "MESSAGE" && notif.conversationId) {
      const existing = conversations.find((c) => c.id === notif.conversationId);
      if (existing) {
        await openConversationFromList(existing);
        return;
      }
      try {
        const convoSnap = await getDoc(doc(db, "conversations", notif.conversationId));
        if (convoSnap.exists()) {
          const data = convoSnap.data();
          const participants: string[] = data.participants || [];
          const otherUserId = participants.find((id) => id !== user?.uid) || "";
          const emails = data.participantEmails || {};
          await openConversationFromList({
            id: convoSnap.id,
            itemId: data.itemId,
            itemTitle: data.itemTitle,
            participants,
            lastMessage: data.lastMessage || "",
            lastMessageTime: data.updatedAt,
            otherUserId,
            otherUserEmail: emails[otherUserId] || data.otherUserEmail || "User",
          });
          return;
        }
      } catch (error: any) {
        console.log("Error opening conversation from notification:", error.message);
      }
    }
    if (notif.itemId) {
      const foundItem = items.find((i) => i.id === notif.itemId);
      if (foundItem) {
        setDetailsBackScreen("notifications");
        setSelectedItem(foundItem);
        setScreen("details");
      }
    }
  };

  const sendMessage = async () => {
    if (!user || !conversationId || !selectedItem || !messageText.trim()) return;
    const receiverId = chatOtherUserId || selectedItem.userId;
    if (!receiverId || receiverId === user.uid) { Alert.alert("Notice", "You cannot message yourself."); return; }
    const text = messageText.trim();
    setMessageText("");
    try {
      await addDoc(collection(db, "conversations", conversationId, "messages"), { senderId: user.uid, receiverId, text: text, createdAt: serverTimestamp() });
      await updateDoc(doc(db, "conversations", conversationId), { lastMessage: text, updatedAt: serverTimestamp() });
      await createNotification(receiverId, "New Message", `Someone messaged you about "${selectedItem.title}"`, "MESSAGE", selectedItem.id, conversationId);
    } catch (error: any) { Alert.alert("Error", error.message); }
  };

  const calculateMatches = async () => {
    setLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, "items"));
      const allItems: Item[] = [];
      querySnapshot.forEach((d) => { allItems.push({ id: d.id, ...(d.data() as Omit<Item, "id">) }); });
      setItems(allItems);
      const lostItems = allItems.filter((item) => !item.hidden && (item.type || "").toUpperCase() === "LOST" && (item.status || "").toUpperCase() === "LOST");
      const foundItems = allItems.filter((item) => !item.hidden && (item.type || "").toUpperCase() === "FOUND" && (item.status || "").toUpperCase() === "FOUND");
      const results: { lostItem: Item; foundItem: Item; score: number }[] = [];
      lostItems.forEach((lostItem) => { foundItems.forEach((foundItem) => { const score = getMatchScore(lostItem, foundItem); if (score >= 40) { results.push({ lostItem, foundItem, score }); } }); });
      results.sort((a, b) => b.score - a.score);
      setMatchResults(results);
      setScreen("matches");
    } catch (error: any) { Alert.alert("Matching Error", error.message); }
    setLoading(false);
  };

  const CategoryPickerModal = ({ visible, onClose, onSelect, selectedCategory }: { visible: boolean; onClose: () => void; onSelect: (category: string) => void; selectedCategory: string }) => (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Select Category</Text>
          <ScrollView style={styles.categoryList}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity key={cat} style={[styles.categoryOption, selectedCategory === cat && styles.categorySelected]} onPress={() => { onSelect(cat); onClose(); }}>
                <Text style={[styles.categoryOptionText, selectedCategory === cat && styles.categorySelectedText]}>{cat}</Text>
                {selectedCategory === cat && <Text style={styles.checkMark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}><Text style={styles.modalCloseText}>Cancel</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // PRIVACY SCREEN (also available before login)
  if (screen === "privacy") {
    return (
      <ScrollView style={styles.container}>
        <TouchableOpacity onPress={() => setScreen(user ? "profile" : "home")} style={styles.backButton}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        <Text style={styles.pageTitle}>Privacy Notice</Text>
        <View style={styles.privacyCard}>
          <Text style={styles.privacyBody}>{PRIVACY_TEXT}</Text>
        </View>
      </ScrollView>
    );
  }

  // LOGIN SCREEN
  if (!user) {
    return (
      <ScrollView contentContainerStyle={styles.authContainer}>
        <Text style={styles.logo}>🎒</Text>
        <Text style={styles.title}>Campus Lost & Found</Text>
        <Text style={styles.subtitle}>{isRegister ? "Create your account" : "Welcome back"}</Text>
        <Text style={styles.campusHint}>SMSU email preferred. Gmail is allowed for testing.</Text>
        <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextInput style={styles.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
        {isRegister && (
          <TouchableOpacity style={styles.privacyCheckRow} onPress={() => setPrivacyAgreed(!privacyAgreed)}>
            <View style={[styles.checkbox, privacyAgreed && styles.checkboxChecked]}>{privacyAgreed ? <Text style={styles.checkboxMark}>✓</Text> : null}</View>
            <Text style={styles.privacyCheckText}>I agree to the privacy notice</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => setScreen("privacy")} style={styles.linkButton}>
          <Text style={styles.linkText}>Read privacy notice</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={handleAuth} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{isRegister ? "Create Account" : "Login"}</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setIsRegister(!isRegister)} style={styles.linkButton}>
          <Text style={styles.linkText}>{isRegister ? "Already have an account? Login" : "Don't have an account? Register"}</Text>
        </TouchableOpacity>
        {!isRegister && (
          <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotButton}>
            <Text style={styles.forgotText}>Forgot Password?</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  // EDIT SCREEN
  if (screen === "edit" && selectedItem) {
    return (
      <ScrollView style={styles.container}>
        <TouchableOpacity onPress={() => setScreen("details")} style={styles.backButton}><Text style={styles.backText}>← Cancel</Text></TouchableOpacity>
        <Text style={styles.pageTitle}>✏️ Edit Item</Text>
        <Text style={styles.fieldLabel}>Item Name</Text>
        <TextInput style={styles.input} placeholder="Item name" value={editTitle} onChangeText={setEditTitle} />
        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput style={[styles.input, styles.textArea]} placeholder="Description" value={editDescription} onChangeText={setEditDescription} multiline />
        <Text style={styles.fieldLabel}>Category</Text>
        <TouchableOpacity style={styles.pickerButton} onPress={() => setShowEditCategoryModal(true)}>
          <Text style={editCategory ? styles.pickerText : styles.pickerPlaceholder}>{editCategory || "Select a category"}</Text>
          <Text style={styles.pickerArrow}>▼</Text>
        </TouchableOpacity>
        <CategoryPickerModal visible={showEditCategoryModal} onClose={() => setShowEditCategoryModal(false)} onSelect={setEditCategory} selectedCategory={editCategory} />
        <Text style={styles.fieldLabel}>Location</Text>
        <TextInput style={styles.input} placeholder="Location" value={editLocation} onChangeText={setEditLocation} />
        <Text style={styles.fieldLabel}>Date {selectedItem.type === "LOST" ? "Lost" : "Found"}</Text>
        <TouchableOpacity style={styles.pickerButton} onPress={() => setShowEditDatePicker(true)}>
          <Text style={editDate ? styles.pickerText : styles.pickerPlaceholder}>{editDate || "Select date"}</Text>
          <Text style={styles.pickerArrow}>📅</Text>
        </TouchableOpacity>
        {showEditDatePicker && (<DateTimePicker value={editDateObj} mode="date" display={Platform.OS === "ios" ? "spinner" : "default"} onChange={(event, selectedDate) => { setShowEditDatePicker(Platform.OS === "ios"); if (selectedDate) { setEditDateObj(selectedDate); setEditDate(formatDate(selectedDate)); } }} />)}
        {editImage ? <Image source={{ uri: editImage }} style={styles.formImage} /> : null}
        <TouchableOpacity style={styles.photoButton} onPress={() => pickImage("edit")}><Text style={styles.photoButtonText}>{editImage ? "📷 Change Photo" : "📷 Add Photo (Optional)"}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={handleSaveEdit} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>💾 Save Changes</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteItem(selectedItem)}><Text style={styles.deleteButtonText}>🗑️ Delete Item</Text></TouchableOpacity>
      </ScrollView>
    );
  }

  // CONVERSATIONS SCREEN
  if (screen === "conversations") {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setScreen("home")} style={styles.backButton}><Text style={styles.backText}>← Home</Text></TouchableOpacity>
        <Text style={styles.pageTitle}>💬 My Messages</Text>
        {loading ? (<ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 40 }} />) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefreshConversations} colors={["#2563eb"]} tintColor="#2563eb" />}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.convoCard} onPress={() => openConversationFromList(item)}>
                <View style={styles.convoIcon}><Text style={styles.convoIconText}>💬</Text></View>
                <View style={styles.convoContent}>
                  <Text style={styles.convoTitle} numberOfLines={1}>{item.itemTitle}</Text>
                  <Text style={styles.convoLastMessage} numberOfLines={1}>{item.otherUserEmail || "User"}</Text>
                  <Text style={styles.convoLastMessage} numberOfLines={1}>{item.lastMessage || "No messages yet"}</Text>
                </View>
                <Text style={styles.convoTime}>{formatMessageTime(item.lastMessageTime)}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<View style={styles.emptyConvo}><Text style={styles.emptyConvoIcon}>💬</Text><Text style={styles.emptyConvoTitle}>No conversations yet</Text><Text style={styles.emptyConvoText}>Start a conversation by messaging someone about their item.</Text></View>}
          />
        )}
      </View>
    );
  }

  // NOTIFICATIONS SCREEN
  if (screen === "notifications") {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setScreen("home")} style={styles.backButton}><Text style={styles.backText}>← Home</Text></TouchableOpacity>
        <View style={styles.notifHeader}>
          <Text style={styles.pageTitle}>🔔 Notifications</Text>
          {unreadCount > 0 && (<TouchableOpacity onPress={markAllNotificationsRead}><Text style={styles.markAllRead}>Mark all read</Text></TouchableOpacity>)}
        </View>
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefreshNotifications} colors={["#2563eb"]} tintColor="#2563eb" />}
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.notifCard, !item.read && styles.notifUnread]} onPress={() => openNotification(item)}>
              <View style={styles.notifIconContainer}><Text style={styles.notifIcon}>{item.type === "MATCH" ? "🔔" : item.type === "MESSAGE" ? "💬" : "📋"}</Text></View>
              <View style={styles.notifContent}>
                <Text style={styles.notifTitle}>{item.title}</Text>
                <Text style={styles.notifMessage}>{item.message}</Text>
                {!item.read && <View style={styles.unreadDot} />}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<View style={styles.emptyNotif}><Text style={styles.emptyNotifIcon}>🔔</Text><Text style={styles.emptyNotifTitle}>No notifications yet</Text><Text style={styles.emptyNotifText}>You'll be notified about messages, possible matches, and recovered items.</Text></View>}
        />
      </View>
    );
  }

  // DETAILS SCREEN
  if (screen === "details" && selectedItem) {
    return (
      <ScrollView style={styles.container}>
        <TouchableOpacity onPress={() => setScreen(detailsBackScreen)} style={styles.backButton}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        <Text style={styles.pageTitle}>{selectedItem.title}</Text>
        <View style={[styles.badge, selectedItem.type === "LOST" ? styles.lostBadge : styles.foundBadge]}><Text style={styles.badgeText}>{selectedItem.type}</Text></View>
        {selectedItem.imageUrl ? <Image source={{ uri: selectedItem.imageUrl }} style={styles.detailImage} /> : null}
        <View style={styles.detailCard}>
          <Text style={styles.detailLabel}>Category</Text><Text style={styles.detailValue}>{selectedItem.category}</Text>
          <Text style={styles.detailLabel}>Description</Text><Text style={styles.detailValue}>{selectedItem.description}</Text>
          <Text style={styles.detailLabel}>Location</Text><Text style={styles.detailValue}>{selectedItem.location}</Text>
          <Text style={styles.detailLabel}>Date</Text><Text style={styles.detailValue}>{selectedItem.dateLost || selectedItem.dateFound}</Text>
          <Text style={styles.detailLabel}>Status</Text><Text style={styles.detailValue}>{selectedItem.status}</Text>
          {selectedItem.hidden ? <Text style={styles.hiddenBanner}>This post is hidden by a moderator.</Text> : null}
        </View>
        {selectedItem.userId === user?.uid ? (
          <>
            <View style={styles.ownerNotice}><Text style={styles.ownerNoticeText}>This is your own report.</Text></View>
            <TouchableOpacity style={styles.editButton} onPress={() => openEditScreen(selectedItem)}><Text style={styles.editButtonText}>✏️ Edit Item</Text></TouchableOpacity>
            {selectedItem.status !== "RECOVERED" ? (
              <TouchableOpacity style={styles.recoveredButton} onPress={() => markAsRecovered(selectedItem)}><Text style={styles.recoveredButtonText}>✅ Mark as Recovered</Text></TouchableOpacity>
            ) : (
              <View style={styles.recoveredNotice}><Text style={styles.recoveredNoticeText}>✅ This item has been recovered.</Text></View>
            )}
            <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteItem(selectedItem)}><Text style={styles.deleteButtonText}>🗑️ Delete Item</Text></TouchableOpacity>
            {isAdminEmail(user?.email) ? (
              <TouchableOpacity style={styles.editButton} onPress={() => toggleHiddenItem(selectedItem)}>
                <Text style={styles.editButtonText}>{selectedItem.hidden ? "👁 Unhide Post" : "🚫 Hide Post"}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.primaryButton} onPress={openConversation} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>💬 Message Owner</Text>}
            </TouchableOpacity>
            {isAdminEmail(user?.email) ? (
              <>
                <TouchableOpacity style={styles.editButton} onPress={() => toggleHiddenItem(selectedItem)}>
                  <Text style={styles.editButtonText}>{selectedItem.hidden ? "👁 Unhide Post" : "🚫 Hide Post"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteItem(selectedItem)}><Text style={styles.deleteButtonText}>🗑️ Delete as Moderator</Text></TouchableOpacity>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    );
  }

  // MATCHES SCREEN
  if (screen === "matches") {
    return (
      <ScrollView style={styles.container}>
        <TouchableOpacity onPress={() => setScreen("home")} style={styles.backButton}><Text style={styles.backText}>← Home</Text></TouchableOpacity>
        <Text style={styles.pageTitle}>🔔 Possible Matches</Text>
        <Text style={styles.matchIntro}>Matches are based on category, location, keywords, and date.</Text>
        {matchResults.length === 0 ? (
          <View style={styles.noMatchCard}><Text style={styles.noMatchTitle}>No possible matches yet</Text><Text style={styles.noMatchText}>Add detailed lost and found reports to improve matching.</Text></View>
        ) : (
          matchResults.map((match, index) => {
            const reasons = getMatchBreakdown(match.lostItem, match.foundItem);
            return (
              <View key={`${match.lostItem.id}-${match.foundItem.id}-${index}`} style={styles.matchCard}>
                <View style={styles.matchScoreCircle}><Text style={styles.matchScore}>{match.score}%</Text></View>
                <Text style={styles.matchLabel}>{getMatchLabel(match.score)}</Text>
                <Text style={styles.matchReasonTitle}>Why this matches</Text>
                <View style={styles.reasonBox}>
                  <Text style={styles.reasonText}>{reasons.category ? "✓" : "○"} Category</Text>
                  <Text style={styles.reasonText}>{reasons.location ? "✓" : "○"} Location</Text>
                  <Text style={styles.reasonText}>{reasons.keywords ? "✓" : "○"} Keywords</Text>
                  <Text style={styles.reasonText}>{reasons.date ? "✓" : "○"} Date</Text>                </View>
                <Text style={styles.matchSectionTitle}>🔍 Lost Item</Text>
                <Text style={styles.matchItemTitle}>{match.lostItem.title}</Text>
                <Text style={styles.matchInfo}>📁 {match.lostItem.category}</Text>
                <Text style={styles.matchInfo}>📍 {match.lostItem.location}</Text>
                <Text style={styles.matchInfo}>📅 {match.lostItem.dateLost}</Text>
                <View style={styles.matchDivider} />
                <Text style={styles.matchSectionTitle}>📦 Found Item</Text>
                <Text style={styles.matchItemTitle}>{match.foundItem.title}</Text>
                <Text style={styles.matchInfo}>📁 {match.foundItem.category}</Text>
                <Text style={styles.matchInfo}>📍 {match.foundItem.location}</Text>
                <Text style={styles.matchInfo}>📅 {match.foundItem.dateFound}</Text>
                <TouchableOpacity style={styles.matchButton} onPress={() => { setSelectedItem(match.foundItem); setDetailsBackScreen("matches"); setScreen("details"); }}><Text style={styles.buttonText}>View Found Item</Text></TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>
    );
  }

  // MESSAGES SCREEN
  if (screen === "messages" && selectedItem && conversationId) {
    return (
      <KeyboardAvoidingView style={styles.messageContainer} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}>
        <TouchableOpacity onPress={() => setScreen("conversations")} style={styles.backButton}><Text style={styles.backText}>← Back to Messages</Text></TouchableOpacity>
        <View style={styles.messageItemHeader}>
          <Text style={styles.messageItemTitle}>{selectedItem.title}</Text>
          <Text style={styles.messageItemSubtitle}>{selectedItem.type} • {selectedItem.location}</Text>
        </View>
        <FlatList
          ref={messageListRef}
          style={styles.messageList}
          data={messages}
          keyExtractor={(item) => item.id}
          onContentSizeChange={() => messageListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => messageListRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const isMine = item.senderId === user?.uid;
            return (
              <View style={[styles.messageBubble, isMine ? styles.myMessage : styles.theirMessage]}>
                <Text style={isMine ? styles.myMessageText : styles.theirMessageText}>{item.text}</Text>
                <Text style={[styles.messageTime, isMine ? styles.myMessageTime : styles.theirMessageTime]}>{formatMessageTime(item.createdAt)}</Text>
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.emptyText}>No messages yet. Start the conversation!</Text>}
        />
        <View style={styles.messageInputRow}>
          <TextInput style={styles.messageInput} placeholder="Type a message..." value={messageText} onChangeText={setMessageText} multiline />
          <TouchableOpacity style={styles.sendButton} onPress={sendMessage}><Text style={styles.sendButtonText}>➤</Text></TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // LOST ITEM SCREEN
  if (screen === "lost") {
    return (
      <ScrollView style={styles.container}>
        <TouchableOpacity onPress={() => setScreen("home")} style={styles.backButton}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        <Text style={styles.pageTitle}>🔍 Report Lost Item</Text>
        <Text style={styles.fieldLabel}>Item Name</Text>
        <TextInput style={styles.input} placeholder="e.g., Black Backpack" value={lostTitle} onChangeText={setLostTitle} />
        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput style={[styles.input, styles.textArea]} placeholder="Describe your item in detail..." value={lostDescription} onChangeText={setLostDescription} multiline />
        <Text style={styles.fieldLabel}>Category</Text>
        <TouchableOpacity style={styles.pickerButton} onPress={() => setShowLostCategoryModal(true)}>
          <Text style={lostCategory ? styles.pickerText : styles.pickerPlaceholder}>{lostCategory || "Select a category"}</Text>
          <Text style={styles.pickerArrow}>▼</Text>
        </TouchableOpacity>
        <CategoryPickerModal visible={showLostCategoryModal} onClose={() => setShowLostCategoryModal(false)} onSelect={setLostCategory} selectedCategory={lostCategory} />
        <Text style={styles.fieldLabel}>Location</Text>
        <TextInput style={styles.input} placeholder="e.g., Library, Building A" value={lostLocation} onChangeText={setLostLocation} />
        <Text style={styles.fieldLabel}>Date Lost</Text>
        <TouchableOpacity style={styles.pickerButton} onPress={() => setShowLostDatePicker(true)}>
          <Text style={dateLost ? styles.pickerText : styles.pickerPlaceholder}>{dateLost || "Select date"}</Text>
          <Text style={styles.pickerArrow}>📅</Text>
        </TouchableOpacity>
        {showLostDatePicker && (<DateTimePicker value={lostDateObj} mode="date" display={Platform.OS === "ios" ? "spinner" : "default"} maximumDate={new Date()} onChange={(event, selectedDate) => { setShowLostDatePicker(Platform.OS === "ios"); if (selectedDate) { setLostDateObj(selectedDate); setDateLost(formatDate(selectedDate)); } }} />)}
        {Platform.OS === "ios" && showLostDatePicker && (<TouchableOpacity style={styles.datePickerDone} onPress={() => setShowLostDatePicker(false)}><Text style={styles.datePickerDoneText}>Done</Text></TouchableOpacity>)}
        {lostImage ? <Image source={{ uri: lostImage }} style={styles.formImage} /> : null}
        <TouchableOpacity style={styles.photoButton} onPress={() => pickImage("lost")}><Text style={styles.photoButtonText}>{lostImage ? "📷 Change Photo" : "📷 Add Photo (Optional)"}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={handleSubmitLostItem} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit Lost Item</Text>}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // FOUND ITEM SCREEN
  if (screen === "found") {
    return (
      <ScrollView style={styles.container}>
        <TouchableOpacity onPress={() => setScreen("home")} style={styles.backButton}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        <Text style={styles.pageTitle}>📦 Report Found Item</Text>
        <Text style={styles.fieldLabel}>Item Name</Text>
        <TextInput style={styles.input} placeholder="e.g., Blue Water Bottle" value={foundTitle} onChangeText={setFoundTitle} />
        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput style={[styles.input, styles.textArea]} placeholder="Describe the item in detail..." value={foundDescription} onChangeText={setFoundDescription} multiline />
        <Text style={styles.fieldLabel}>Category</Text>
        <TouchableOpacity style={styles.pickerButton} onPress={() => setShowFoundCategoryModal(true)}>
          <Text style={foundCategory ? styles.pickerText : styles.pickerPlaceholder}>{foundCategory || "Select a category"}</Text>
          <Text style={styles.pickerArrow}>▼</Text>
        </TouchableOpacity>
        <CategoryPickerModal visible={showFoundCategoryModal} onClose={() => setShowFoundCategoryModal(false)} onSelect={setFoundCategory} selectedCategory={foundCategory} />
        <Text style={styles.fieldLabel}>Location</Text>
        <TextInput style={styles.input} placeholder="e.g., Cafeteria, Room 101" value={foundLocation} onChangeText={setFoundLocation} />
        <Text style={styles.fieldLabel}>Date Found</Text>
        <TouchableOpacity style={styles.pickerButton} onPress={() => setShowFoundDatePicker(true)}>
          <Text style={dateFound ? styles.pickerText : styles.pickerPlaceholder}>{dateFound || "Select date"}</Text>
          <Text style={styles.pickerArrow}>📅</Text>
        </TouchableOpacity>
        {showFoundDatePicker && (<DateTimePicker value={foundDateObj} mode="date" display={Platform.OS === "ios" ? "spinner" : "default"} maximumDate={new Date()} onChange={(event, selectedDate) => { setShowFoundDatePicker(Platform.OS === "ios"); if (selectedDate) { setFoundDateObj(selectedDate); setDateFound(formatDate(selectedDate)); } }} />)}
        {Platform.OS === "ios" && showFoundDatePicker && (<TouchableOpacity style={styles.datePickerDone} onPress={() => setShowFoundDatePicker(false)}><Text style={styles.datePickerDoneText}>Done</Text></TouchableOpacity>)}
        {foundImage ? <Image source={{ uri: foundImage }} style={styles.formImage} /> : null}
        <TouchableOpacity style={styles.photoButton} onPress={() => pickImage("found")}><Text style={styles.photoButtonText}>{foundImage ? "📷 Change Photo" : "📷 Add Photo (Optional)"}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={handleSubmitFoundItem} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit Found Item</Text>}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // BROWSE SCREEN
  if (screen === "browse") {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setScreen("home")} style={styles.backButton}><Text style={styles.backText}>← Home</Text></TouchableOpacity>
        <Text style={styles.pageTitle}>Browse Items</Text>
        <TextInput style={styles.input} placeholder="🔎 Search items..." value={searchText} onChangeText={setSearchText} />
        <View style={styles.filterRow}>
          <TouchableOpacity style={[styles.filterButton, typeFilter === "ALL" && styles.activeFilter]} onPress={() => setTypeFilter("ALL")}><Text style={typeFilter === "ALL" ? styles.activeFilterText : styles.filterText}>All</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.filterButton, typeFilter === "LOST" && styles.activeFilter]} onPress={() => setTypeFilter("LOST")}><Text style={typeFilter === "LOST" ? styles.activeFilterText : styles.filterText}>Lost</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.filterButton, typeFilter === "FOUND" && styles.activeFilter]} onPress={() => setTypeFilter("FOUND")}><Text style={typeFilter === "FOUND" ? styles.activeFilterText : styles.filterText}>Found</Text></TouchableOpacity>
        </View>
        <TextInput style={styles.input} placeholder="Filter by category" value={categoryFilter} onChangeText={setCategoryFilter} />
        <TextInput style={styles.input} placeholder="Filter by location" value={locationFilter} onChangeText={setLocationFilter} />
        <TouchableOpacity style={styles.clearButton} onPress={clearFilters}><Text style={styles.clearText}>Clear Filters</Text></TouchableOpacity>
        <Text style={styles.sortLabel}>Sort by:</Text>
        <View style={styles.sortRow}>
          <TouchableOpacity style={[styles.sortButton, sortBy === "newest" && styles.activeSortButton]} onPress={() => setSortBy("newest")}><Text style={sortBy === "newest" ? styles.activeSortText : styles.sortText}>Newest</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.sortButton, sortBy === "oldest" && styles.activeSortButton]} onPress={() => setSortBy("oldest")}><Text style={sortBy === "oldest" ? styles.activeSortText : styles.sortText}>Oldest</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.sortButton, sortBy === "az" && styles.activeSortButton]} onPress={() => setSortBy("az")}><Text style={sortBy === "az" ? styles.activeSortText : styles.sortText}>A-Z</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.sortButton, sortBy === "za" && styles.activeSortButton]} onPress={() => setSortBy("za")}><Text style={sortBy === "za" ? styles.activeSortText : styles.sortText}>Z-A</Text></TouchableOpacity>
        </View>
        <Text style={styles.resultText}>{filteredItems.length} item(s) found</Text>
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefreshBrowse} colors={["#2563eb"]} tintColor="#2563eb" />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.itemCard} onPress={() => { setSelectedItem(item); setDetailsBackScreen("browse"); setScreen("details"); }}>
              {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.cardImage} /> : null}
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={item.type === "LOST" ? styles.lostText : styles.foundText}>{item.type}</Text>
              </View>
              <Text style={styles.categoryTag}>📁 {item.category}</Text>
              <Text style={styles.description}>{item.description}</Text>
              <Text>📍 {item.location}</Text>
              <Text>📅 {item.dateLost || item.dateFound}</Text>
              <Text style={item.status === "RECOVERED" ? styles.recoveredText : styles.statusText}>Status: {item.status}</Text>
              <Text style={styles.tapText}>Tap to view details →</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No items found.</Text>}
        />
      </View>
    );
  }

  // PROFILE SCREEN
  if (screen === "profile") {
    const myItems = items.filter((item) => item.userId === user?.uid);
    const lostCount = myItems.filter((item) => item.type === "LOST").length;
    const foundCount = myItems.filter((item) => item.type === "FOUND").length;
    const recoveredCount = myItems.filter((item) => item.status === "RECOVERED").length;
    return (
      <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefreshProfile} colors={["#2563eb"]} tintColor="#2563eb" />}>
        <TouchableOpacity onPress={() => setScreen("home")} style={styles.backButton}><Text style={styles.backText}>← Home</Text></TouchableOpacity>
        <Text style={styles.pageTitle}>My Profile 👤</Text>
        <View style={styles.profileCard}>
          <Text style={styles.profileIcon}>👤</Text>
          <Text style={styles.profileLabel}>Email</Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>
          <Text style={styles.profileHint}>SMSU Campus Lost & Found</Text>
        </View>
        <Text style={styles.sectionTitle}>My Reports</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCard}><Text style={styles.statNumber}>{myItems.length}</Text><Text style={styles.statLabel}>Total</Text></View>
          <View style={styles.statCard}><Text style={styles.statNumber}>{lostCount}</Text><Text style={styles.statLabel}>Lost</Text></View>
          <View style={styles.statCard}><Text style={styles.statNumber}>{foundCount}</Text><Text style={styles.statLabel}>Found</Text></View>
          <View style={[styles.statCard, styles.statCardGreen]}><Text style={[styles.statNumber, styles.statNumberGreen]}>{recoveredCount}</Text><Text style={styles.statLabel}>Recovered</Text></View>
        </View>
        <Text style={styles.sectionTitle}>My Reported Items</Text>
        {myItems.length === 0 ? (<Text style={styles.emptyText}>You haven't reported any items yet.</Text>) : (
          myItems.map((item) => (
            <TouchableOpacity key={item.id} style={styles.itemCard} onPress={() => { setSelectedItem(item); setDetailsBackScreen("profile"); setScreen("details"); }}>
              {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.cardImage} /> : null}
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={item.type === "LOST" ? styles.lostText : styles.foundText}>{item.type}</Text>
              </View>
              <Text style={styles.categoryTag}>📁 {item.category}</Text>
              <Text>📍 {item.location}</Text>
              <Text>📅 {item.dateLost || item.dateFound}</Text>
              <Text style={item.status === "RECOVERED" ? styles.recoveredText : styles.statusText}>Status: {item.status}</Text>
              <Text style={styles.tapText}>Tap to edit or delete →</Text>
            </TouchableOpacity>
          ))
        )}
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen("privacy")}><Text style={styles.secondaryButtonText}>Privacy Notice</Text></TouchableOpacity>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}><Text style={styles.logoutText}>Logout</Text></TouchableOpacity>
      </ScrollView>
    );
  }

  // MODERATION SCREEN
  if (screen === "moderate") {
    if (!isAdminEmail(user?.email)) {
      return (
        <View style={styles.container}>
          <TouchableOpacity onPress={() => setScreen("home")} style={styles.backButton}><Text style={styles.backText}>← Home</Text></TouchableOpacity>
          <Text style={styles.pageTitle}>Moderation</Text>
          <Text style={styles.emptyText}>You are not a moderator.</Text>
        </View>
      );
    }
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setScreen("home")} style={styles.backButton}><Text style={styles.backText}>← Home</Text></TouchableOpacity>
        <Text style={styles.pageTitle}>Moderation</Text>
        <Text style={styles.matchIntro}>Hide posts that are inappropriate or not related to lost-and-found. Hidden posts leave browse and matching.</Text>
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefreshProfile} colors={["#2563eb"]} tintColor="#2563eb" />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.itemCard} onPress={() => { setSelectedItem(item); setDetailsBackScreen("moderate"); setScreen("details"); }}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={item.type === "LOST" ? styles.lostText : styles.foundText}>{item.type}</Text>
              </View>
              <Text style={styles.categoryTag}>📁 {item.category}</Text>
              <Text>📍 {item.location}</Text>
              <Text>Reported by {item.userEmail}</Text>
              {item.hidden ? <Text style={styles.hiddenBanner}>Hidden</Text> : <Text style={styles.statusText}>Visible</Text>}
              <Text style={styles.tapText}>Tap to hide, unhide, or delete →</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No items to review.</Text>}
        />
      </View>
    );
  }

  // HOME SCREEN WITH DASHBOARD
  return (
    <ScrollView style={styles.container}>
      <View style={styles.homeHeader}>
        <Text style={styles.logo}>🎒</Text>
        <TouchableOpacity style={styles.notifBell} onPress={() => setScreen("notifications")}>
          <Text style={styles.bellIcon}>🔔</Text>
          {unreadCount > 0 && (<View style={styles.bellBadge}><Text style={styles.bellBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text></View>)}
        </TouchableOpacity>
      </View>
      <Text style={styles.title}>Campus Lost & Found</Text>
      <Text style={styles.subtitle}>Welcome!</Text>
      <Text style={styles.emailText}>{user?.email}</Text>

      <View style={styles.dashboardCard}>
        <Text style={styles.dashboardTitle}>📊 Quick Stats</Text>
        <View style={styles.dashboardRow}>
          <View style={styles.dashboardStat}>
            <Text style={styles.dashboardNumber}>{items.filter((i) => !i.hidden && i.type === "LOST" && i.status !== "RECOVERED").length}</Text>
            <Text style={styles.dashboardLabel}>🔍 Lost</Text>
          </View>
          <View style={styles.dashboardStat}>
            <Text style={styles.dashboardNumber}>{items.filter((i) => !i.hidden && i.type === "FOUND" && i.status !== "RECOVERED").length}</Text>
            <Text style={styles.dashboardLabel}>📦 Found</Text>
          </View>
          <View style={styles.dashboardStat}>
            <Text style={[styles.dashboardNumber, styles.dashboardGreen]}>{items.filter((i) => !i.hidden && i.status === "RECOVERED").length}</Text>
            <Text style={styles.dashboardLabel}>✅ Recovered</Text>
          </View>
        </View>
        <View style={styles.dashboardDivider} />
        <View style={styles.dashboardRow}>
          <View style={styles.dashboardStat}>
            <Text style={styles.dashboardNumber}>{items.filter((i) => i.userId === user?.uid).length}</Text>
            <Text style={styles.dashboardLabel}>📝 My Reports</Text>
          </View>
          <View style={styles.dashboardStat}>
            <Text style={styles.dashboardNumber}>{conversations.length}</Text>
            <Text style={styles.dashboardLabel}>💬 Chats</Text>
          </View>
          <View style={styles.dashboardStat}>
            <Text style={[styles.dashboardNumber, unreadCount > 0 ? styles.dashboardRed : {}]}>{unreadCount}</Text>
            <Text style={styles.dashboardLabel}>🔔 Unread</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={() => setScreen("lost")}><Text style={styles.buttonText}>🔍 Report Lost Item</Text></TouchableOpacity>
      <TouchableOpacity style={styles.primaryButton} onPress={() => setScreen("found")}><Text style={styles.buttonText}>📦 Report Found Item</Text></TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={calculateMatches}><Text style={styles.secondaryButtonText}>🔔 Possible Matches</Text></TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={openBrowseItems}><Text style={styles.secondaryButtonText}>🔎 Browse Items</Text></TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={async () => { setLoading(true); await loadItems(); await loadConversations(); setLoading(false); setScreen("conversations"); }}><Text style={styles.secondaryButtonText}>💬 My Messages</Text></TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={async () => { await loadItems(); setScreen("profile"); }}><Text style={styles.secondaryButtonText}>👤 My Profile</Text></TouchableOpacity>
      {isAdminEmail(user?.email) ? (
        <TouchableOpacity style={styles.secondaryButton} onPress={async () => { await loadItems(); setScreen("moderate"); }}><Text style={styles.secondaryButtonText}>🛡️ Moderation</Text></TouchableOpacity>
      ) : null}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}><Text style={styles.logoutText}>Logout</Text></TouchableOpacity>
      <Text style={styles.firebaseText}>Firebase Connected ✅</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f7fb", paddingHorizontal: 20, paddingTop: 55, paddingBottom: 20 },
  authContainer: { flexGrow: 1, justifyContent: "center", padding: 25, backgroundColor: "#f5f7fb" },
  logo: { fontSize: 60, textAlign: "center", marginBottom: 10 },
  title: { fontSize: 30, fontWeight: "bold", textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 18, textAlign: "center", color: "#666", marginBottom: 10 },
  emailText: { textAlign: "center", color: "#555", marginBottom: 25 },
  campusHint: { textAlign: "center", color: "#2563eb", marginBottom: 16, fontWeight: "600" },
  privacyCard: { backgroundColor: "#fff", borderRadius: 12, padding: 18, marginBottom: 20 },
  privacyBody: { fontSize: 16, color: "#333", lineHeight: 24 },
  privacyCheckRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 10 },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderColor: "#2563eb", borderRadius: 6, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: "#2563eb" },
  checkboxMark: { color: "#fff", fontWeight: "bold" },
  privacyCheckText: { flex: 1, color: "#333", fontSize: 15 },
  hiddenBanner: { color: "#b45309", fontWeight: "bold", marginTop: 8 },
  pageTitle: { fontSize: 28, fontWeight: "bold", marginBottom: 20 },
  sectionTitle: { fontSize: 21, fontWeight: "bold", marginBottom: 12 },
  fieldLabel: { fontSize: 15, fontWeight: "600", color: "#444", marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd", borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 16 },
  textArea: { height: 110, textAlignVertical: "top" },
  pickerButton: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd", borderRadius: 10, padding: 14, marginBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pickerText: { fontSize: 16, color: "#222" },
  pickerPlaceholder: { fontSize: 16, color: "#999" },
  pickerArrow: { fontSize: 14, color: "#666" },
  datePickerDone: { alignSelf: "flex-end", backgroundColor: "#2563eb", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginBottom: 12 },
  datePickerDoneText: { color: "#fff", fontWeight: "bold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "70%" },
  modalTitle: { fontSize: 20, fontWeight: "bold", textAlign: "center", marginBottom: 15 },
  categoryList: { maxHeight: 350 },
  categoryOption: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#eee" },
  categorySelected: { backgroundColor: "#eff6ff" },
  categoryOptionText: { fontSize: 16, color: "#333" },
  categorySelectedText: { color: "#2563eb", fontWeight: "bold" },
  checkMark: { color: "#2563eb", fontSize: 18, fontWeight: "bold" },
  modalCloseButton: { backgroundColor: "#f3f4f6", padding: 16, borderRadius: 10, alignItems: "center", marginTop: 15 },
  modalCloseText: { color: "#666", fontSize: 16, fontWeight: "bold" },
  primaryButton: { backgroundColor: "#2563eb", padding: 16, borderRadius: 10, alignItems: "center", marginBottom: 14 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  secondaryButton: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#2563eb", padding: 16, borderRadius: 10, alignItems: "center", marginBottom: 14 },
  secondaryButtonText: { color: "#2563eb", fontSize: 16, fontWeight: "bold" },
  editButton: { backgroundColor: "#fef3c7", borderWidth: 1, borderColor: "#f59e0b", padding: 16, borderRadius: 10, alignItems: "center", marginBottom: 14 },
  editButtonText: { color: "#b45309", fontSize: 16, fontWeight: "bold" },
  deleteButton: { backgroundColor: "#fee2e2", borderWidth: 1, borderColor: "#dc2626", padding: 16, borderRadius: 10, alignItems: "center", marginBottom: 14 },
  deleteButtonText: { color: "#dc2626", fontSize: 16, fontWeight: "bold" },
  logoutButton: { backgroundColor: "#fee2e2", padding: 16, borderRadius: 10, alignItems: "center", marginTop: 10, marginBottom: 20 },
  logoutText: { color: "#dc2626", fontSize: 16, fontWeight: "bold" },
  linkButton: { alignItems: "center", marginTop: 10 },
  linkText: { color: "#2563eb", fontSize: 15 },
  forgotButton: { alignItems: "center", marginTop: 15 },
  forgotText: { color: "#dc2626", fontSize: 15, fontWeight: "600" },
  backButton: { alignSelf: "flex-start", paddingVertical: 10, paddingHorizontal: 8, marginTop: 0, marginBottom: 15 },
  backText: { color: "#2563eb", fontSize: 20, fontWeight: "bold" },
  badge: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 15 },
  lostBadge: { backgroundColor: "#fee2e2" },
  foundBadge: { backgroundColor: "#dcfce7" },
  badgeText: { fontWeight: "bold" },
  categoryTag: { color: "#555", marginBottom: 4 },
  detailImage: { width: "100%", height: 240, borderRadius: 14, marginBottom: 15, backgroundColor: "#e5e7eb" },
  formImage: { width: "100%", height: 200, borderRadius: 12, marginBottom: 12, backgroundColor: "#e5e7eb" },
  cardImage: { width: "100%", height: 180, borderRadius: 10, marginBottom: 12, backgroundColor: "#e5e7eb" },
  photoButton: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#2563eb", padding: 14, borderRadius: 10, alignItems: "center", marginBottom: 14 },
  photoButtonText: { color: "#2563eb", fontWeight: "bold" },
  detailCard: { backgroundColor: "#fff", borderRadius: 12, padding: 18, marginBottom: 20 },
  detailLabel: { fontSize: 14, color: "#777", marginTop: 12, marginBottom: 4, fontWeight: "bold" },
  detailValue: { fontSize: 17, color: "#222" },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  filterButton: { flex: 1, backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd", padding: 10, borderRadius: 8, alignItems: "center" },
  activeFilter: { backgroundColor: "#dbeafe", borderColor: "#2563eb" },
  filterText: { color: "#666" },
  activeFilterText: { color: "#2563eb", fontWeight: "bold" },
  clearButton: { alignItems: "center", padding: 8, marginBottom: 8 },
  clearText: { color: "#2563eb", fontWeight: "bold" },
  sortLabel: { fontSize: 14, fontWeight: "bold", color: "#444", marginBottom: 8 },
  sortRow: { flexDirection: "row", gap: 6, marginBottom: 12 },
  sortButton: { flex: 1, backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd", padding: 8, borderRadius: 8, alignItems: "center" },
  activeSortButton: { backgroundColor: "#dbeafe", borderColor: "#2563eb" },
  sortText: { color: "#666", fontSize: 12 },
  activeSortText: { color: "#2563eb", fontWeight: "bold", fontSize: 12 },
  resultText: { color: "#666", marginBottom: 10 },
  itemCard: { backgroundColor: "#fff", padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: "#e5e7eb" },
  itemHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  itemTitle: { fontSize: 19, fontWeight: "bold", flex: 1 },
  lostText: { color: "#dc2626", fontWeight: "bold" },
  foundText: { color: "#16a34a", fontWeight: "bold" },
  description: { color: "#555", marginVertical: 8 },
  tapText: { color: "#2563eb", marginTop: 10, fontWeight: "bold" },
  emptyText: { textAlign: "center", color: "#777", fontSize: 16, marginTop: 20 },
  ownerNotice: { backgroundColor: "#e5e7eb", padding: 16, borderRadius: 10, alignItems: "center", marginBottom: 14 },
  ownerNoticeText: { color: "#555", fontWeight: "bold" },
  recoveredButton: { backgroundColor: "#16a34a", padding: 16, borderRadius: 10, alignItems: "center", marginBottom: 14 },
  recoveredButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  recoveredNotice: { backgroundColor: "#dcfce7", padding: 16, borderRadius: 10, alignItems: "center", marginBottom: 14 },
  recoveredNoticeText: { color: "#166534", fontWeight: "bold" },
  recoveredText: { color: "#16a34a", fontWeight: "bold", marginTop: 5 },
  statusText: { color: "#666", marginTop: 5 },
  matchReasonTitle: { fontSize: 15, fontWeight: "bold", marginBottom: 6, color: "#444" },
  reasonBox: { backgroundColor: "#f8fafc", borderRadius: 10, padding: 12, marginBottom: 15 },
  reasonText: { fontSize: 14, marginBottom: 4, color: "#555" },
  matchIntro: { color: "#666", lineHeight: 22, marginBottom: 15 },
  matchCard: { backgroundColor: "#fff", borderRadius: 14, padding: 18, marginBottom: 15, borderWidth: 1, borderColor: "#dbeafe" },
  matchScoreCircle: { alignSelf: "center", width: 75, height: 75, borderRadius: 38, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  matchScore: { fontSize: 22, fontWeight: "bold", color: "#2563eb" },
  matchLabel: { textAlign: "center", fontSize: 17, fontWeight: "bold", color: "#2563eb", marginBottom: 15 },
  matchSectionTitle: { fontSize: 15, fontWeight: "bold", color: "#666", marginBottom: 5 },
  matchItemTitle: { fontSize: 19, fontWeight: "bold", marginBottom: 7 },
  matchInfo: { color: "#555", marginBottom: 4 },
  matchDivider: { height: 1, backgroundColor: "#e5e7eb", marginVertical: 15 },
  matchButton: { backgroundColor: "#2563eb", padding: 14, borderRadius: 10, alignItems: "center", marginTop: 15 },
  noMatchCard: { backgroundColor: "#fff", borderRadius: 14, padding: 25, alignItems: "center" },
  noMatchTitle: { fontSize: 19, fontWeight: "bold", marginBottom: 8 },
  noMatchText: { textAlign: "center", color: "#666", lineHeight: 22 },
  messageContainer: { flex: 1, backgroundColor: "#f5f7fb", paddingHorizontal: 20, paddingTop: 55 },
  messageItemHeader: { backgroundColor: "#fff", padding: 14, borderRadius: 10, marginBottom: 12 },
  messageItemTitle: { fontSize: 18, fontWeight: "bold" },
  messageItemSubtitle: { color: "#666", marginTop: 4 },
  messageList: { flex: 1 },
  messageBubble: { maxWidth: "80%", padding: 12, borderRadius: 14, marginBottom: 8 },
  myMessage: { alignSelf: "flex-end", backgroundColor: "#2563eb" },
  theirMessage: { alignSelf: "flex-start", backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb" },
  myMessageText: { color: "#fff", fontSize: 16 },
  theirMessageText: { color: "#222", fontSize: 16 },
  messageTime: { fontSize: 11, marginTop: 4 },
  myMessageTime: { color: "rgba(255,255,255,0.7)", textAlign: "right" },
  theirMessageTime: { color: "#999" },
  messageInputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingTop: 10, paddingBottom: 20 },
  messageInput: { flex: 1, backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, maxHeight: 100, fontSize: 16 },
  sendButton: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center" },
  sendButtonText: { color: "#fff", fontSize: 22, fontWeight: "bold" },
  profileCard: { backgroundColor: "#fff", borderRadius: 15, padding: 25, alignItems: "center", marginBottom: 25 },
  profileIcon: { fontSize: 55, marginBottom: 10 },
  profileLabel: { color: "#777", fontSize: 14 },
  profileEmail: { fontSize: 17, fontWeight: "bold", marginTop: 5 },
  profileHint: { color: "#777", fontSize: 13, marginTop: 8 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 25 },
  statCard: { flex: 1, minWidth: "22%", backgroundColor: "#fff", padding: 15, borderRadius: 12, alignItems: "center" },
  statCardGreen: { backgroundColor: "#dcfce7" },
  statNumber: { fontSize: 24, fontWeight: "bold", color: "#2563eb" },
  statNumberGreen: { color: "#16a34a" },
  statLabel: { color: "#666", marginTop: 4, fontSize: 12 },
  firebaseText: { textAlign: "center", color: "#16a34a", marginTop: 15, marginBottom: 30, fontWeight: "bold" },
  homeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  notifBell: { position: "relative", padding: 10 },
  bellIcon: { fontSize: 28 },
  bellBadge: { position: "absolute", top: 5, right: 5, backgroundColor: "#dc2626", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center" },
  bellBadgeText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  notifHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15 },
  markAllRead: { color: "#2563eb", fontWeight: "bold" },
  notifCard: { flexDirection: "row", backgroundColor: "#fff", padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: "#e5e7eb" },
  notifUnread: { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" },
  notifIconContainer: { width: 45, height: 45, borderRadius: 23, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center", marginRight: 12 },
  notifIcon: { fontSize: 22 },
  notifContent: { flex: 1, position: "relative" },
  notifTitle: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
  notifMessage: { color: "#666", fontSize: 14 },
  unreadDot: { position: "absolute", top: 5, right: 5, width: 10, height: 10, borderRadius: 5, backgroundColor: "#2563eb" },
  emptyNotif: { alignItems: "center", padding: 40 },
  emptyNotifIcon: { fontSize: 50, marginBottom: 15 },
  emptyNotifTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 8 },
  emptyNotifText: { color: "#666", textAlign: "center", lineHeight: 22 },
  convoCard: { flexDirection: "row", backgroundColor: "#fff", padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: "#e5e7eb", alignItems: "center" },
  convoIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center", marginRight: 12 },
  convoIconText: { fontSize: 24 },
  convoContent: { flex: 1 },
  convoTitle: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
  convoLastMessage: { color: "#666", fontSize: 14 },
  convoTime: { color: "#999", fontSize: 12 },
  emptyConvo: { alignItems: "center", padding: 40 },
  emptyConvoIcon: { fontSize: 50, marginBottom: 15 },
  emptyConvoTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 8 },
  emptyConvoText: { color: "#666", textAlign: "center", lineHeight: 22 },
  dashboardCard: { backgroundColor: "#fff", borderRadius: 16, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: "#e5e7eb" },
  dashboardTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 15, textAlign: "center" },
  dashboardRow: { flexDirection: "row", justifyContent: "space-around" },
  dashboardStat: { alignItems: "center", flex: 1 },
  dashboardNumber: { fontSize: 28, fontWeight: "bold", color: "#2563eb" },
  dashboardGreen: { color: "#16a34a" },
  dashboardRed: { color: "#dc2626" },
  dashboardLabel: { fontSize: 12, color: "#666", marginTop: 4, textAlign: "center" },
  dashboardDivider: { height: 1, backgroundColor: "#e5e7eb", marginVertical: 15 },
});