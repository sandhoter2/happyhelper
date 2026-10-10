from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("interview", "0015_add_theme_to_userprofile"),
    ]

    operations = [
        migrations.CreateModel(
            name="QuestionBank",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("question", models.TextField()),
                ("category", models.CharField(
                    choices=[
                        ("behavioral", "Behavioral"), ("technical", "Technical"),
                        ("system_design", "System Design"), ("coding", "Coding"),
                        ("culture", "Culture Fit"), ("leadership", "Leadership"),
                    ],
                    default="behavioral", max_length=20,
                )),
                ("difficulty", models.CharField(
                    choices=[("easy", "Easy"), ("medium", "Medium"), ("hard", "Hard")],
                    default="medium", max_length=10,
                )),
                ("role", models.CharField(blank=True, max_length=100)),
                ("company", models.CharField(blank=True, max_length=100)),
                ("tags", models.CharField(blank=True, max_length=200)),
                ("hint", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["category", "difficulty", "created_at"]},
        ),
        migrations.AlterField(
            model_name="interviewsession",
            name="session_type",
            field=models.CharField(
                choices=[
                    ("interview", "Interview"),
                    ("meeting", "Teams Meeting"),
                    ("mock_interview", "Mock Interview"),
                ],
                default="interview",
                max_length=20,
            ),
        ),
    ]
