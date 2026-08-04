package sg.gov.wls.smsforwarder;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private Config config;
    private EditText etApiUrl, etSenders;
    private Switch swEnabled;
    private TextView tvStatus;

    private final ActivityResultLauncher<String[]> permLauncher =
            registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), result -> {
                updateStatus();
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        config = new Config(this);

        etApiUrl = findViewById(R.id.et_api_url);
        etSenders = findViewById(R.id.et_senders);
        swEnabled = findViewById(R.id.sw_enabled);
        tvStatus = findViewById(R.id.tv_status);
        Button btnSave = findViewById(R.id.btn_save);
        Button btnPermissions = findViewById(R.id.btn_permissions);
        Button btnTest = findViewById(R.id.btn_test);

        // Load saved values
        etApiUrl.setText(config.getApiUrl());
        etSenders.setText(config.getAllowedSenders());
        swEnabled.setChecked(config.isEnabled());

        swEnabled.setOnCheckedChangeListener((CompoundButton b, boolean checked) -> {
            config.setEnabled(checked);
            updateStatus();
        });

        btnSave.setOnClickListener(v -> {
            String url = etApiUrl.getText().toString().trim();
            String senders = etSenders.getText().toString().trim();
            if (url.isEmpty()) {
                Toast.makeText(this, "API URL cannot be empty", Toast.LENGTH_SHORT).show();
                return;
            }
            config.setApiUrl(url);
            config.setAllowedSenders(senders);
            Toast.makeText(this, "✓ Settings saved", Toast.LENGTH_SHORT).show();
            updateStatus();
        });

        btnPermissions.setOnClickListener(v -> requestRequiredPermissions());

        btnTest.setOnClickListener(v -> {
            // Send a test SMS payload to the API
            String testSms =
                "CWS447\n75%\nRISE\n2026-04-27 19:34:49\n" +
                "Water Level:100.630mRL(2.069m)\nCope:101.295mRL(2.73m)\n" +
                "Critical:101.891mRL(3.330m)\nTg Katong Rd South OD (ECP Service Rd)";
            android.content.Intent svc = new android.content.Intent(this, ForwardService.class);
            svc.putExtra("smsText", testSms);
            svc.putExtra("senderName", "TEST");
            startForegroundService(svc);
            Toast.makeText(this, "Sending test payload…", Toast.LENGTH_SHORT).show();
        });

        updateStatus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateStatus();
    }

    private void updateStatus() {
        boolean hasSms = ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS)
                == PackageManager.PERMISSION_GRANTED;
        boolean hasNet = true; // INTERNET is install-time

        StringBuilder sb = new StringBuilder();
        sb.append("Status: ").append(config.isEnabled() ? "✓ ACTIVE" : "✗ DISABLED").append("\n");
        sb.append("SMS permission: ").append(hasSms ? "✓ Granted" : "✗ Missing — tap Grant Permissions").append("\n");
        sb.append("API: ").append(config.getApiUrl());
        tvStatus.setText(sb.toString());
    }

    private void requestRequiredPermissions() {
        List<String> needed = new ArrayList<>();
        String[] perms = {
                Manifest.permission.RECEIVE_SMS,
                Manifest.permission.READ_SMS,
        };
        for (String p : perms) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                needed.add(p);
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }
        if (!needed.isEmpty()) {
            permLauncher.launch(needed.toArray(new String[0]));
        } else {
            Toast.makeText(this, "All permissions already granted", Toast.LENGTH_SHORT).show();
        }
    }
}
