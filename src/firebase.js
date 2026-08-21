import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCFeO-CV57XOZd7FGyXbCwDWbuFl3GvAgA",
  authDomain: "civi-ai-f772a.firebaseapp.com",
  projectId: "civi-ai-f772a",
  storageBucket: "civi-ai-f772a.firebasestorage.app",
  messagingSenderId: "208416373884",
  appId: "1:208416373884:web:8f08d8de5bbb8027ac5df9",
  measurementId: "G-3D651JMX7R"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
