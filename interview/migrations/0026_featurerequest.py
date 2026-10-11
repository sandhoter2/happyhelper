from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("interview", "0025_userprofile_doc_context_chars"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="FeatureRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=200)),
                ("description", models.TextField()),
                ("category", models.CharField(
                    choices=[("feature", "New Feature"), ("bug", "Bug Report"), ("improvement", "Improvement")],
                    default="feature",
                    max_length=20,
                )),
                ("status", models.CharField(
                    choices=[
                        ("pending", "Pending Review"),
                        ("approved", "Approved"),
                        ("rejected", "Rejected"),
                        ("in_progress", "In Progress"),
                        ("done", "Done"),
                    ],
                    default="pending",
                    max_length=20,
                )),
                ("admin_note", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "submitted_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="feature_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
