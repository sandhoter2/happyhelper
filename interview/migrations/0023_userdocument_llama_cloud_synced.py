from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("interview", "0022_userdocument_llama_file_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="userdocument",
            name="llama_cloud_synced",
            field=models.BooleanField(default=False),
        ),
    ]
