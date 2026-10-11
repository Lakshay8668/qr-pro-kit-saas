// src/lib/storage.js — upload PDFs / menus / images to Firebase Storage (owner-only write, public read)
// Lazy-loads firebase/storage so the library is never loaded unless Cloud Storage is configured and used.

import { isStorageConfigured, firebaseConfig, getStorageInstance } from "./firebase";

export const MAX_UPLOAD_MB = 10;
const OK_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"];

export async function uploadUserFile(uid, file, onProgress) {
  if (!file) throw new Error("Choose a file first.");
  if (!OK_TYPES.includes(file.type)) throw new Error("Only PDF, PNG, JPG, WEBP or GIF files are allowed.");
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`File is too large (max ${MAX_UPLOAD_MB} MB).`);

  if (!isStorageConfigured()) {
    throw new Error(
      `Cloud Storage is not enabled on this Firebase Starter tier project (${firebaseConfig.projectId || "delta-abbey-4f38q"}). ` +
      `To host file uploads, enable Cloud Storage in Firebase Console (Build → Storage) or enter a direct file URL.`
    );
  }

  const storage = await getStorageInstance();
  const { ref, uploadBytesResumable, getDownloadURL } = await import("firebase/storage");

  return new Promise((resolve, reject) => {
    const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
    let task;
    try {
      task = uploadBytesResumable(ref(storage, `uploads/${uid}/${Date.now()}-${safe}`), file, { contentType: file.type });
    } catch (e) {
      return reject(
        new Error(
          `Cloud Storage is unavailable (${e?.message || "initialization error"}). ` +
          `Ensure Cloud Storage is provisioned in Firebase Console or use a direct URL.`
        )
      );
    }

    task.on(
      "state_changed",
      (s) => onProgress && onProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
      (err) => {
        const code = err?.code || "";
        let msg = err?.message || "Upload failed.";
        if (code === "storage/bucket-not-found" || code === "storage/project-not-found") {
          msg = `Cloud Storage bucket "${firebaseConfig.storageBucket}" was not found. Enable Cloud Storage in Firebase Console (Build → Storage).`;
        } else if (code === "storage/unauthorized") {
          msg = "Upload blocked by Storage security rules. Publish storage.rules in Firebase Console.";
        } else if (code === "storage/quota-exceeded") {
          msg = "Cloud Storage quota exceeded. Upgrade your Firebase plan or delete older files.";
        } else if (code === "storage/retry-limit-exceeded" || code === "storage/unknown") {
          msg = "Could not reach Cloud Storage. Check if Storage is enabled in Firebase Console.";
        }
        reject(new Error(msg));
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(task.snapshot.ref);
          resolve(downloadUrl);
        } catch (e) {
          reject(new Error(`Failed to retrieve download URL: ${e?.message || "error"}`));
        }
      }
    );
  });
}
