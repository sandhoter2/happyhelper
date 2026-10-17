import uuid
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("interview", "0026_featurerequest"),
    ]

    operations = [
        migrations.CreateModel(
            name="OriginalTranscript",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("content", models.TextField()),
                ("speaker_type", models.CharField(
                    choices=[("microphone", "Microphone"), ("system", "System Audio"), ("note", "Note")],
                    default="microphone",
                    max_length=20,
                )),
                ("speaker_name", models.CharField(blank=True, max_length=100)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("session", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="original_transcripts",
                    to="interview.interviewsession",
                )),
                ("transcript_entry", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="originals",
                    to="interview.transcriptentry",
                )),
            ],
            options={
                "verbose_name": "Original Transcript",
                "verbose_name_plural": "Original Transcripts",
                "ordering": ["created_at"],
            },
        ),
    ]
