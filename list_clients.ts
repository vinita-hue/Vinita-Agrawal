
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json' assert { type: 'json' };

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function listClients() {
  const querySnapshot = await getDocs(collection(db, 'clients'));
  console.log('--- Current Clients ---');
  querySnapshot.forEach((doc) => {
    console.log(`${doc.id}: ${doc.data().name}`);
  });
  process.exit(0);
}

listClients().catch(err => {
  console.error(err);
  process.exit(1);
});
