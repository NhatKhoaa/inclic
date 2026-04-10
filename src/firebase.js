import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBW2590e8-RZ5k8sbM25xJiYTJCei-5e60",
  authDomain: "inclic.firebaseapp.com",
  projectId: "inclic",
  storageBucket: "inclic.firebasestorage.app",
  messagingSenderId: "807923000905",
  appId: "1:807923000905:web:cfcd1e16b6b9044adc8198"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
