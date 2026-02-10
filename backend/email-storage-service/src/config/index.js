// Load global environment variables first
import dotenv from 'dotenv';
import { loadGlobalEnv } from '../../../config/load-env.js';
loadGlobalEnv(dotenv);

export const config = {
    port : process.env.PORT || 4002,
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
        redirectUri: process.env.GOOGLE_EMAIL_REDIRECT_URI || 'http://localhost:4002/auth/google/callback',
    }
};