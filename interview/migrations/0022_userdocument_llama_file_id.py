from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("interview", "0021_document_folders"),
    ]

    operations = [
        migrations.AddField(
            model_name="userdocument",
            name="llama_file_id",
            field=models.CharField(blank=True, max_length=128),
        ),
    ]
