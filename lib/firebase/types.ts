export type WorkspaceUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  mode: 'demo' | 'firebase';
};

export type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  appId: string;
};
