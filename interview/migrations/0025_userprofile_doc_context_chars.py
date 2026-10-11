from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("interview", "0024_remove_sessiondocument_unique_session_document_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="doc_context_chars",
            field=models.IntegerField(
                default=6000,
                help_text="Max total document chars sent to AI per session.",
            ),
        ),
    ]
