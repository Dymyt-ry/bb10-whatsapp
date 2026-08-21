package dev.golobokov.bbwa;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.MenuItem;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.Toast;

import dev.golobokov.bbwa.api.ApiClient;

public class SettingsActivity extends Activity {

    private EditText editBackendUrl;
    private EditText editApiToken;
    private CheckBox checkSelfSigned;
    private CheckBox checkCleartext;

    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        if (getActionBar() != null) {
            getActionBar().setDisplayHomeAsUpEnabled(true);
        }

        editBackendUrl = (EditText) findViewById(R.id.edit_backend_url);
        editApiToken = (EditText) findViewById(R.id.edit_api_token);
        checkSelfSigned = (CheckBox) findViewById(R.id.check_self_signed);
        checkCleartext = (CheckBox) findViewById(R.id.check_cleartext);
        Button btnSave = (Button) findViewById(R.id.btn_save);

        SharedPreferences prefs = getSharedPreferences(ApiClient.PREFS_NAME, MODE_PRIVATE);
        editBackendUrl.setText(prefs.getString(ApiClient.KEY_BACKEND_URL, ""));
        editApiToken.setText(prefs.getString(ApiClient.KEY_API_TOKEN, ""));
        checkSelfSigned.setChecked(prefs.getBoolean(ApiClient.KEY_ALLOW_SELF_SIGNED, false));
        checkCleartext.setChecked(prefs.getBoolean(ApiClient.KEY_ALLOW_CLEARTEXT, false));

        // Turning verification off is worth one confirmation; turning it back
        // on is not.
        checkSelfSigned.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                if (checkSelfSigned.isChecked()) {
                    confirmSelfSigned();
                }
            }
        });

        checkCleartext.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                if (checkCleartext.isChecked()) {
                    confirmCleartext();
                }
            }
        });

        btnSave.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                saveSettings();
            }
        });
    }

    private void confirmSelfSigned() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.label_self_signed)
                .setMessage(R.string.warn_self_signed)
                .setPositiveButton(android.R.string.ok, null)
                .setNegativeButton(android.R.string.cancel, new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface dialog, int which) {
                        checkSelfSigned.setChecked(false);
                    }
                })
                .setOnCancelListener(new DialogInterface.OnCancelListener() {
                    public void onCancel(DialogInterface dialog) {
                        checkSelfSigned.setChecked(false);
                    }
                })
                .show();
    }

    private void confirmCleartext() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.label_cleartext)
                .setMessage(R.string.warn_cleartext)
                .setPositiveButton(android.R.string.ok, null)
                .setNegativeButton(android.R.string.cancel, new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface dialog, int which) {
                        checkCleartext.setChecked(false);
                    }
                })
                .setOnCancelListener(new DialogInterface.OnCancelListener() {
                    public void onCancel(DialogInterface dialog) {
                        checkCleartext.setChecked(false);
                    }
                })
                .show();
    }

    private void saveSettings() {
        String url = editBackendUrl.getText().toString().trim();
        String token = editApiToken.getText().toString().trim();
        boolean selfSigned = checkSelfSigned.isChecked();
        boolean cleartext = checkCleartext.isChecked();

        if (url.length() == 0 || token.length() == 0) {
            Toast.makeText(this, R.string.settings_required, Toast.LENGTH_SHORT).show();
            return;
        }
        String canonicalUrl = ApiClient.canonicalizeBackendUrl(url, cleartext);
        if (canonicalUrl == null) {
            Toast.makeText(this, R.string.settings_https_required, Toast.LENGTH_LONG).show();
            return;
        }

        SharedPreferences.Editor editor =
                getSharedPreferences(ApiClient.PREFS_NAME, MODE_PRIVATE).edit();
        editor.putString(ApiClient.KEY_BACKEND_URL, canonicalUrl);
        editor.putString(ApiClient.KEY_API_TOKEN, token);
        editor.putBoolean(ApiClient.KEY_ALLOW_SELF_SIGNED, selfSigned);
        editor.putBoolean(ApiClient.KEY_ALLOW_CLEARTEXT, cleartext);
        editor.apply();

        ApiClient.configure(canonicalUrl, token, selfSigned, cleartext);

        Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show();
        finish();
    }

    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == android.R.id.home) {
            finish();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }
}
