package dev.golobokov.bbwa;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import dev.golobokov.bbwa.api.ApiClient;
import dev.golobokov.bbwa.ContactResolver;
import dev.golobokov.bbwa.model.Chat;
import dev.golobokov.bbwa.service.PollingService;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

import java.io.IOException;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Request;
import okhttp3.Response;

public class ChatListActivity extends Activity {

    private static final long POLL_INTERVAL = 4000;

    private ListView listView;
    private List<Chat> chats = new ArrayList<Chat>();
    private ChatAdapter adapter;
    private Handler handler = new Handler(Looper.getMainLooper());
    private boolean polling = false;

    private Runnable pollRunnable = new Runnable() {
        public void run() {
            if (polling) {
                fetchChats();
                handler.postDelayed(this, POLL_INTERVAL);
            }
        }
    };

    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ApiClient.init(this);
        if (!ApiClient.isConfigured(this)) {
            startActivity(new Intent(this, SettingsActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_chat_list);

        PollingService.schedulePolling(this);

        listView = (ListView) findViewById(R.id.chat_list);
        adapter = new ChatAdapter();
        listView.setAdapter(adapter);

        listView.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                Chat chat = chats.get(position);
                String resolvedName = chat.getName();
                String number = ContactResolver.extractNumber(chat.getId());
                String contactName = ContactResolver.getName(ChatListActivity.this, number);
                if (contactName != null) resolvedName = contactName;

                Intent intent = new Intent(ChatListActivity.this, MessageActivity.class);
                intent.putExtra("chatId", chat.getId());
                intent.putExtra("chatName", resolvedName != null ? resolvedName : chat.getId());
                startActivity(intent);
            }
        });

        fetchChats();
    }

    protected void onResume() {
        super.onResume();
        ApiClient.init(this);

        // Re-query contacts/aliases in case the user made changes while away.
        ContactResolver.clearCache();
        if (adapter != null) {
            adapter.notifyDataSetChanged();
        }

        polling = true;
        handler.postDelayed(pollRunnable, POLL_INTERVAL);
    }

    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.menu_chat_list, menu);
        return true;
    }

    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == R.id.action_settings) {
            startActivity(new Intent(this, SettingsActivity.class));
            return true;
        } else if (item.getItemId() == R.id.action_about) {
            new android.app.AlertDialog.Builder(this)
                .setTitle(R.string.about_title)
                .setMessage("BBWA " + versionName() + "\nWhatsApp for BlackBerry 10 and legacy Android")
                .setPositiveButton(android.R.string.ok, null)
                .show();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    protected void onPause() {
        super.onPause();
        polling = false;
        handler.removeCallbacks(pollRunnable);
    }

    /** Version straight from the manifest, so it cannot drift from the build. */
    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (android.content.pm.PackageManager.NameNotFoundException e) {
            return "";
        }
    }

    private void fetchChats() {
        String url = ApiClient.getBaseUrl() + "/chats";
        Request request = new Request.Builder().url(url).get().build();

        ApiClient.getClient().newCall(request).enqueue(new Callback() {
            public void onFailure(Call call, final IOException e) {
                final String msg = e.getMessage();
                handler.post(new Runnable() {
                    public void run() {
                        Toast.makeText(ChatListActivity.this,
                                "Failed to load chats: " + (msg != null ? msg : e.getClass().getSimpleName()),
                                Toast.LENGTH_LONG).show();
                    }
                });
            }

            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    response.close();
                    return;
                }

                String body = response.body().string();
                Type listType = new TypeToken<List<Chat>>() {}.getType();
                final List<Chat> result = new Gson().fromJson(body, listType);
                if (result == null) return;

                handler.post(new Runnable() {
                    public void run() {
                        chats.clear();
                        chats.addAll(result);
                        adapter.notifyDataSetChanged();
                    }
                });
            }
        });
    }

    private class ChatAdapter extends BaseAdapter {

        public int getCount() {
            return chats.size();
        }

        public Object getItem(int position) {
            return chats.get(position);
        }

        public long getItemId(int position) {
            return position;
        }

        public View getView(int position, View convertView, ViewGroup parent) {
            if (convertView == null) {
                convertView = LayoutInflater.from(ChatListActivity.this)
                        .inflate(R.layout.item_chat, parent, false);
            }

            Chat chat = chats.get(position);
            TextView nameView = (TextView) convertView.findViewById(R.id.chat_name);
            TextView lastMsgView = (TextView) convertView.findViewById(R.id.chat_last_message);
            TextView badgeView = (TextView) convertView.findViewById(R.id.chat_unread_badge);

            String number = ContactResolver.extractNumber(chat.getId());
            String contactName = ContactResolver.getName(ChatListActivity.this, number);
            String displayName = contactName != null ? contactName
                    : (chat.getName() != null ? chat.getName() : chat.getId());
            nameView.setText(displayName);
            lastMsgView.setText(chat.getLastMessage() != null ? chat.getLastMessage() : "");

            int unread = chat.getUnreadCount();
            if (unread > 0) {
                badgeView.setText(unread > 99 ? "99+" : String.valueOf(unread));
                badgeView.setVisibility(View.VISIBLE);
            } else {
                badgeView.setVisibility(View.GONE);
            }

            return convertView;
        }
    }
}
