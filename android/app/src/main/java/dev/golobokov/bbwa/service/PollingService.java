package dev.golobokov.bbwa.service;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Log;

import dev.golobokov.bbwa.MessageActivity;
import dev.golobokov.bbwa.api.ApiClient;
import dev.golobokov.bbwa.model.Chat;
import dev.golobokov.bbwa.model.Message;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

import java.io.IOException;
import java.lang.reflect.Type;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Request;
import okhttp3.Response;

public class PollingService extends Service {

    private static final String TAG = "PollingService";
    private static final long POLL_INTERVAL = 60 * 1000;
    private static HashMap<String, Long> lastTimestamps = new HashMap<String, Long>();
    private static final AtomicInteger notificationId = new AtomicInteger(1);
    private final Object runsLock = new Object();
    private final Set<PollRun> activeRuns = new HashSet<PollRun>();
    private int latestStartId = 0;

    public IBinder onBind(Intent intent) {
        return null;
    }

    public static void schedulePolling(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, PollingService.class);
        PendingIntent pendingIntent = PendingIntent.getService(context, 0, intent, 0);

        alarmManager.setInexactRepeating(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + POLL_INTERVAL,
                POLL_INTERVAL,
                pendingIntent
        );
    }

    public int onStartCommand(Intent intent, int flags, int startId) {
        PollRun run = beginRun(startId);
        // Alarms and BOOT_COMPLETED can start this service in a fresh process,
        // before any Activity has initialized the static client state. Always
        // reload preferences here, then stop without constructing a request if
        // the URL is missing or is an invalid legacy value.
        try {
            ApiClient.init(this);
            if (!ApiClient.isConfigured(this)) {
                Log.w(TAG, "Polling skipped: backend is not safely configured");
                run.release();
                return START_NOT_STICKY;
            }
            pollForMessages(run);
        } catch (RuntimeException e) {
            // Preference corruption or request construction must complete this
            // start just like an asynchronous failure: no request, no leak.
            Log.e(TAG, "Polling could not start: " + e.getMessage());
            run.release();
        }
        return START_NOT_STICKY;
    }

    private PollRun beginRun(int startId) {
        PollRun run = new PollRun(startId);
        synchronized (runsLock) {
            activeRuns.add(run);
            // onStartCommand is delivered in start order on the main thread.
            latestStartId = startId;
        }
        return run;
    }

    private void finishRun(PollRun run) {
        int stopId = 0;
        synchronized (runsLock) {
            activeRuns.remove(run);
            if (activeRuns.isEmpty()) {
                // If a newer start completed before an older one, stopping with
                // the older id would be ignored. Use the newest id only after
                // every run is complete; a concurrently arriving newer start
                // makes stopSelf(oldId) a safe no-op by Android semantics.
                stopId = latestStartId;
            }
        }
        if (stopId != 0) {
            stopSelf(stopId);
        }
    }

    private final class PollRun {
        private final int startId;
        // The initial token belongs to the outer /chats request. Each nested
        // notification lookup retains another token before it is enqueued.
        private final AtomicInteger pending = new AtomicInteger(1);

        PollRun(int startId) {
            this.startId = startId;
        }

        void retain() {
            pending.incrementAndGet();
        }

        void release() {
            int remaining = pending.decrementAndGet();
            if (remaining == 0) {
                finishRun(this);
            } else if (remaining < 0) {
                Log.e(TAG, "Polling completion underflow for startId " + startId);
            }
        }
    }

    private void pollForMessages(final PollRun run) {
        try {
            String url = ApiClient.getBaseUrl() + "/chats";
            Request request = new Request.Builder().url(url).get().build();

            ApiClient.getClient().newCall(request).enqueue(new Callback() {
                public void onFailure(Call call, IOException e) {
                    try {
                        Log.e(TAG, "Poll failed: " + e.getMessage());
                    } finally {
                        run.release();
                    }
                }

                public void onResponse(Call call, Response response) {
                    try {
                        if (!response.isSuccessful()) return;

                        String body = response.body().string();
                        Type listType = new TypeToken<List<Chat>>() {}.getType();
                        List<Chat> chats = new Gson().fromJson(body, listType);
                        if (chats == null || chats.isEmpty()) return;

                        for (int i = 0; i < chats.size(); i++) {
                            Chat chat = chats.get(i);
                            String chatId = chat.getId();
                            long ts = chat.getTimestamp();

                            boolean shouldNotify;
                            synchronized (lastTimestamps) {
                                Long prev = lastTimestamps.get(chatId);
                                shouldNotify = prev != null && ts > prev.longValue();
                                if (prev == null || ts > prev.longValue()) {
                                    lastTimestamps.put(chatId, Long.valueOf(ts));
                                }
                            }
                            if (shouldNotify) {
                                checkAndNotify(chatId, chat.getName(), run);
                            }
                        }
                    } catch (IOException e) {
                        Log.e(TAG, "Poll response failed: " + e.getMessage());
                    } catch (RuntimeException e) {
                        Log.e(TAG, "Poll response was invalid: " + e.getMessage());
                    } finally {
                        try {
                            response.close();
                        } finally {
                            run.release();
                        }
                    }
                }
            });
        } catch (RuntimeException e) {
            Log.e(TAG, "Poll request failed: " + e.getMessage());
            run.release();
        }
    }

    private void checkAndNotify(final String chatId, final String chatName,
                                final PollRun run) {
        try {
            String url = ApiClient.getBaseUrl() + "/chat/" + chatId;
            Request request = new Request.Builder().url(url).get().build();

            run.retain();
            try {
                ApiClient.getClient().newCall(request).enqueue(new Callback() {
                    public void onFailure(Call call, IOException e) {
                        try {
                            Log.e(TAG, "checkAndNotify fetch failed: " + e.getMessage());
                        } finally {
                            run.release();
                        }
                    }

                    public void onResponse(Call call, Response response) {
                        try {
                            if (!response.isSuccessful()) return;

                            String body = response.body().string();
                            Type listType = new TypeToken<List<Message>>() {}.getType();
                            List<Message> msgs = new Gson().fromJson(body, listType);
                            if (msgs == null || msgs.isEmpty()) return;

                            Message last = msgs.get(msgs.size() - 1);

                            // notify: true → show; null → show for backward compatibility.
                            Boolean notifyFlag = last.getNotify();
                            if (notifyFlag != null && !notifyFlag.booleanValue()) return;

                            String content = last.getNotifyText() != null ? last.getNotifyText()
                                    : (last.getText() != null ? last.getText() : "New message");
                            showNotification(chatId, chatName, content);
                        } catch (IOException e) {
                            Log.e(TAG, "Notification response failed: " + e.getMessage());
                        } catch (RuntimeException e) {
                            Log.e(TAG, "Notification response was invalid: " + e.getMessage());
                        } finally {
                            try {
                                response.close();
                            } finally {
                                run.release();
                            }
                        }
                    }
                });
            } catch (RuntimeException e) {
                // retain() happened before enqueue(), so a synchronous enqueue
                // failure must release the nested token here.
                run.release();
                throw e;
            }
        } catch (RuntimeException e) {
            Log.e(TAG, "Notification request failed: " + e.getMessage());
        }
    }

    private void showNotification(String chatId, String chatName, String text) {
        Intent intent = new Intent(this, MessageActivity.class);
        intent.putExtra("chatId", chatId);
        intent.putExtra("chatName", chatName);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(this, chatId.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT);

        String title = chatName != null ? chatName : chatId;
        String content = text != null ? text : "New message";

        Notification notification = new Notification.Builder(this)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle(title)
                .setContentText(content)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setDefaults(Notification.DEFAULT_ALL)
                .build();

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(notificationId.getAndIncrement(), notification);
    }
}
