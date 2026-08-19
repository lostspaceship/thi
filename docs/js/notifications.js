const SUPABASE_URL = 'https://bfztqagofwviunbdbhqg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmenRxYWdvZnd2aXVuYmRiaHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MTI3MTgsImV4cCI6MjEwMjE4ODcxOH0.3V95oDSjONyn2-z_bdS9n2t97Tme66jhrzYQUts-xS8';
const SUPABASE_TABLE = 'subscriptions';
const PUBLIC_VAPID_KEY = 'BFLPEiu4aojiVWR_03OhHLz2nVRoRij-kQOtFAnZATXOINM1LiCNXFoRO-1h7WbtPoTTwgvddA1cVzG5FFBcTn4';

const subscribeButton = document.getElementById('subscribe-button');
const unsubscribeButton = document.getElementById('unsubscribe-button');
const statusElement = document.getElementById('status');

let serviceWorkerRegistration;

function setStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    }
}

function isConfigReady() {
    const ready = ![
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        PUBLIC_VAPID_KEY,
    ].some((value) => value.startsWith('YOUR_') || value.includes('YOUR_PROJECT'));
    return ready;
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let index = 0; index < rawData.length; index += 1) {
        outputArray[index] = rawData.charCodeAt(index);
    }

    return outputArray;
}

function getApplicationServerKey() {
    if (PUBLIC_VAPID_KEY.startsWith('sb_publishable_')) {
        throw new Error('De meldingensleutel is verkeerd ingesteld.');
    }

    if (!/^[A-Za-z0-9_-]+$/.test(PUBLIC_VAPID_KEY)) {
        throw new Error('PUBLIC_VAPID_KEY moet een base64url-gecodeerde VAPID public key zijn.');
    }

    const applicationServerKey = urlBase64ToUint8Array(PUBLIC_VAPID_KEY);

    if (applicationServerKey.length !== 65) {
        throw new Error('PUBLIC_VAPID_KEY is ongeldig. Voor web push verwacht de browser een P-256 public key van 65 bytes.');
    }

    return applicationServerKey;
}

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service workers worden niet ondersteund in deze browser. Wissel van browser of update naar een recentere versie om u te aboneren op hittestress updates.');
    }

    await navigator.serviceWorker.register('./sw.js');
    return navigator.serviceWorker.ready;
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        throw new Error('Notifications worden niet ondersteund in deze browser.');
    }

    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
        throw new Error('Notificatiepermissie is niet toegekend.');
    }
}

async function createPushSubscription(registration) {
    if (!('PushManager' in window)) {
        throw new Error('Push API wordt niet ondersteund in deze browser.');
    }

    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
        return existingSubscription;
    }

    return registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: getApplicationServerKey(),
    });
}

function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict`;
}

function getCookie(name) {
    return document.cookie.split('; ').reduce((acc, part) => {
        const [k, v] = part.split('=');
        return k === name ? decodeURIComponent(v) : acc;
    }, null);
}

function deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

async function saveSubscription(subscription) {
    const subscriptionData = subscription.toJSON();
    setCookie('subscription', JSON.stringify(subscriptionData), 365);

    // Check if endpoint already exists
    const checkResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=id&data->>'endpoint'=eq.${subscriptionData.endpoint}`,
        {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
        }
    );

    const existing = await checkResponse.json();
    if (existing.length > 0) {
        console.log('Subscription already exists, reusing row id:', existing[0].id);
        setCookie('supabase_row_id', existing[0].id, 365);
        return;
    }

    // Insert new row
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
        },
        body: JSON.stringify([{
            data: {
                endpoint: subscription.endpoint,
                subscription: subscriptionData,
                keys: subscriptionData.keys || null,
                saved_at: new Date().toISOString(),
            },
        }]),
    });

    if (!response.ok) {
        if (response.status === 409) {
            setStatus('Je bent al geabonneerd op notificaties.');
            return;
        }
        const errorBody = await response.text();
        throw new Error(`Opslaan van abonnement mislukt (${response.status}).`);
    }

    const rows = await response.json();
    setCookie('supabase_row_id', rows[0].id, 365);
    console.log('Saved new row id:', rows[0].id);
}

async function removeSubscriptionFromSupabase() {
    const id = getCookie('supabase_row_id');
    if (!id) throw new Error('Geen rij-id gevonden in cookie.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${id}`, {
        method: 'DELETE',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            Prefer: 'return=minimal',
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Verwijderen van abonnement mislukt (${response.status}).`);
    }

    deleteCookie('supabase_row_id');
}

async function subscribeToNotifications() {
    if (!isConfigReady()) {
        throw new Error('De meldingenconfiguratie is nog niet ingesteld.');
    }

    setStatus('Service worker registreren...');
    serviceWorkerRegistration = serviceWorkerRegistration || await registerServiceWorker();

    const existingSubscription = await serviceWorkerRegistration.pushManager.getSubscription();
    if (existingSubscription) {
        setStatus('Je bent al geabonneerd op notificaties in deze browser.');
        return;
    }

    setStatus('Notificatiepermissie aanvragen...');
    await requestNotificationPermission();

    setStatus('Abonnement aanmaken...');
    const subscription = await createPushSubscription(serviceWorkerRegistration);

    setStatus('Abonnement opslaan...');
    await saveSubscription(subscription);

    setStatus('Klaar. Je bent aangemeld voor meldingen.');
}

async function unsubscribeFromNotifications() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service workers worden niet ondersteund in deze browser.');
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
        setStatus('Er is geen actief abonnement om te verwijderen.');
        return;
    }

    const endpoint = subscription.endpoint;
    setStatus('Abonnement verwijderen uit de browser...');
    await subscription.unsubscribe();

    setStatus('Abonnement verwijderen...');
    await removeSubscriptionFromSupabase();

    setStatus('Klaar. Je bent afgemeld voor meldingen.');
}

async function initNotifications() {
    try {
        serviceWorkerRegistration = await registerServiceWorker();
        setStatus('Service worker geregistreerd. Klik op de knop om te abonneren.');
    } catch (error) {
        setStatus(error.message);
        subscribeButton.disabled = true;
        console.error('[initNotifications] startup registration failed', error);
        return;
    }

    subscribeButton.addEventListener('click', async () => {
        subscribeButton.disabled = true;

        try {
            await subscribeToNotifications();
        } catch (error) {
            setStatus(error.message);
            console.error('[subscribe-button click] subscription failed', error);
        } finally {
            subscribeButton.disabled = false;
        }
    });
    unsubscribeButton.addEventListener('click', async () => {
        unsubscribeButton.disabled = true;

        try {
            await unsubscribeFromNotifications();
        } catch (error) {
            setStatus(error.message);
            console.error('[unsubscribe-button click] unsubscribe failed', error);
        } finally {
            unsubscribeButton.disabled = false;
        }
    });
}

void initNotifications();
