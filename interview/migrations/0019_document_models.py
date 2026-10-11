import uuid
import django.db.models.deletion
import interview.models
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("interview", "0018_dedup_prompt_templates"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="DocumentParserConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("parser_type", models.CharField(choices=[("llamaparse", "LlamaParse")], default="llamaparse", max_length=30, unique=True)),
                ("max_documents", models.IntegerField(default=10, help_text="Max documents per user")),
                ("max_total_size_mb", models.FloatField(default=10.0, help_text="Max total size in MB across all documents")),
                ("max_total_pages", models.IntegerField(default=100, help_text="Max total pages across all documents")),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"verbose_name": "Document Parser Config", "verbose_name_plural": "Document Parser Configs"},
        ),
        migrations.CreateModel(
            name="UserDocument",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("original_filename", models.CharField(max_length=255)),
                ("file", models.FileField(blank=True, upload_to=interview.models.user_document_upload_path)),
                ("size_bytes", models.BigIntegerField(default=0)),
                ("page_count", models.IntegerField(default=0)),
                ("llama_job_id", models.CharField(blank=True, max_length=128)),
                ("parsed_text", models.TextField(blank=True)),
                ("status", models.CharField(
                    choices=[("pending", "Pending"), ("processing", "Processing"), ("ready", "Ready"), ("error", "Error")],
                    default="pending", max_length=20,
                )),
                ("error_message", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="documents", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="SessionDocument",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("attached_at", models.DateTimeField(auto_now_add=True)),
                ("document", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="session_documents", to="interview.userdocument")),
                ("session", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="session_documents", to="interview.interviewsession")),
            ],
            options={"ordering": ["attached_at"]},
        ),
        migrations.AddConstraint(
            model_name="sessiondocument",
            constraint=models.UniqueConstraint(fields=["session", "document"], name="unique_session_document"),
        ),
    ]
